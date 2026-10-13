import importlib.util
import json
import os
import sys
import types
import unittest
from decimal import Decimal
from copy import deepcopy
from urllib.parse import parse_qs, urlparse
from pathlib import Path
from typing import Any
from unittest.mock import patch


class FakeClientError(Exception):
    def __init__(self, response: dict[str, Any], operation_name: str = "operation"):
        super().__init__(response)
        self.response = response
        self.operation_name = operation_name


class FakeKey:
    def __init__(self, name: str):
        self.name = name

    def eq(self, value: str) -> tuple[str, str, str]:
        return ("eq", self.name, value)


class FakeS3:
    def __init__(self):
        self.deleted: list[dict[str, str]] = []
        self.heads: dict[str, dict[str, Any]] = {}

    def generate_presigned_url(self, _operation: str, Params: dict[str, Any], **_kwargs: Any):
        return f"https://s3.example.test/{Params['Key']}"

    def head_object(self, Bucket: str, Key: str):
        del Bucket
        if Key not in self.heads:
            raise FakeClientError({"Error": {"Code": "404"}})
        return self.heads[Key]

    def delete_object(self, Bucket: str, Key: str):
        self.deleted.append({"Bucket": Bucket, "Key": Key})
        return {}


class FakeRekognition:
    def __init__(self):
        self.deleted_faces: list[dict[str, Any]] = []

    def index_faces(self, **_kwargs: Any):
        return {"FaceRecords": [{"Face": {"FaceId": "face-1"}}]}

    def compare_faces(self, **_kwargs: Any):
        return {"FaceMatches": []}

    def delete_faces(self, **kwargs: Any):
        self.deleted_faces.append(kwargs)
        return {"DeletedFaces": kwargs["FaceIds"]}


class FakeTable:
    def __init__(self, name: str):
        self.items: dict[str, dict[str, Any]] = {}
        self.deletes: list[dict[str, Any]] = []
        self.puts: list[dict[str, Any]] = []
        self.updates: list[dict[str, Any]] = []

    def put_item(self, Item: dict[str, Any], **_kwargs: Any):
        if _kwargs.get("ConditionExpression") == "attribute_not_exists(id)" and Item["id"] in self.items:
            raise FakeClientError({"Error": {"Code": "ConditionalCheckFailedException"}})
        self.puts.append(Item)
        self.items[self.item_key(Item)] = Item
        return {}

    def get_item(self, Key: dict[str, str], **_kwargs: Any):
        item = self.items.get(self.key_value(Key))
        return {"Item": deepcopy(item)} if item else {}

    def update_item(self, **kwargs: Any):
        self.updates.append(kwargs)
        key = self.key_value(kwargs["Key"])
        item = self.items.get(key, {})
        values = kwargs.get("ExpressionAttributeValues") or {}
        condition = kwargs.get("ConditionExpression", "")
        invalid = (
            ("attribute_not_exists(id)" in condition and bool(item)) or
            ("attribute_exists(id)" in condition and not item) or
            (":owner" in values and item.get("owner_id") != values[":owner"]) or
            ("owner_id = :owner_id" in condition and item.get("owner_id") != values[":owner_id"]) or
            (":not_pending" in values and item.get("deletion_pending", False) != values[":not_pending"]) or
            (":max_refs" in values and item.get("reference_count", 0) >= values[":max_refs"])
        )
        if invalid:
            raise FakeClientError({"Error": {"Code": "ConditionalCheckFailedException"}})
        if ":previous_status" in values and (item.get("owner_id") != values[":owner_id"] or item.get("status") != values[":previous_status"]):
            raise FakeClientError({"Error": {"Code": "ConditionalCheckFailedException"}})
        item = self.items.setdefault(key, dict(kwargs["Key"]))
        for field, parameter in {
            "owner_id": ":owner_id", "event_id": ":event_id", "name": ":name",
            "initials": ":initials", "consent_status": ":consent_status",
            "consent_source": ":consent_source", "consent_captured_at": ":consent_captured_at",
            "host_name": ":host_name", "contact_email": ":contact_email",
            "signup_open": ":signup_open", "intake_version": ":intake_version",
            "gallery_token_hash": ":hash", "gallery_enabled": ":enabled",
            "gallery_expires_at": ":expires", "outcome": ":outcome",
            "gallery_photo_hint": ":photo_id",
            "deletion_pending": ":pending",
        }.items():
            if parameter in values:
                item[field] = values[parameter]
        if ":disabled" in values:
            item["gallery_enabled"] = values[":disabled"]
        if ":delta" in values:
            field = kwargs["ExpressionAttributeNames"]["#count"]
            item[field] = item.get(field, 0) + values[":delta"]
        for field, parameter in {"reference_keys": ":keys", "face_ids": ":face_ids"}.items():
            if parameter in values:
                item[field] = item.get(field, []) + values[parameter]
        if ":status" in values:
            item["status"] = values[":status"]
        for status_key in (":processed", ":failed", ":processing"):
            if f"#status = {status_key}" in kwargs.get("UpdateExpression", ""):
                item["status"] = values[status_key]
        if ":reviewed_at" in values:
            item["reviewed_at"] = values[":reviewed_at"]
        if ":updated_at" in values:
            item["updated_at"] = values[":updated_at"]
        if ":one" in values:
            if "reference_count" in item or ":face_ids" in values:
                item["reference_count"] = int(item.get("reference_count") or 0) + int(
                    values[":one"]
                )
            elif "photo_count" in item:
                item["photo_count"] = int(item.get("photo_count") or 0) + int(
                    values[":one"]
                )
        return {"Attributes": item}

    def delete_item(self, **kwargs: Any):
        self.deletes.append(kwargs)
        key = kwargs["Key"]
        self.items.pop(self.key_value(key), None)
        return {}

    def query(self, **kwargs: Any):
        expression = kwargs.get("KeyConditionExpression")
        if not isinstance(expression, tuple):
            return {"Items": []}

        operator, attribute, value = expression
        if operator != "eq":
            return {"Items": []}

        return {
            "Items": [
                item for item in self.items.values() if item.get(attribute) == value
            ]
        }

    def item_key(self, Item: dict[str, Any]) -> str:
        if "id" in Item:
            return Item["id"]
        return f"{Item['photo_id']}:{Item['person_id']}"

    def key_value(self, Key: dict[str, str]) -> str:
        if "id" in Key:
            return Key["id"]
        return f"{Key['photo_id']}:{Key['person_id']}"


class FakeDynamoResource:
    def __init__(self):
        self.tables: dict[str, FakeTable] = {}

    def Table(self, name: str) -> FakeTable:
        self.tables.setdefault(name, FakeTable(name))
        return self.tables[name]


class FakeSerializer:
    def serialize(self, value):
        if isinstance(value, bool):
            return {"BOOL": value}
        if isinstance(value, (int, float, Decimal)):
            return {"N": str(value)}
        if isinstance(value, str):
            return {"S": value}
        if isinstance(value, dict):
            return {"M": {key: self.serialize(item) for key, item in value.items()}}
        raise TypeError(value)


def decode_values(values):
    def decode(value):
        if "N" in value:
            return Decimal(value["N"])
        if "M" in value:
            return decode_values(value["M"])
        return next(iter(value.values()))
    return {key: decode(value) for key, value in values.items()}


class FakeTransactions:
    def __init__(self):
        self.calls = []

    def transact_write_items(self, TransactItems):
        self.calls.append(TransactItems)
        staged = []
        for operation in TransactItems:
            kind, request = next(iter(operation.items()))
            table = fake_dynamodb.Table(request["TableName"])
            if kind == "Put":
                item = decode_values(request["Item"])
                existing = table.items.get(table.item_key(item))
                values = decode_values(request.get("ExpressionAttributeValues", {}))
                valid = existing is None if not values else (
                    existing and existing.get("owner_id") == values[":owner"] and
                    existing.get("status") == values[":previous"] and
                    (existing.get("updated_at") == values[":revision"] if ":revision" in values else not existing.get("updated_at"))
                )
                staged.append((table, item))
            else:
                key = decode_values(request["Key"])
                existing = table.items.get(table.key_value(key))
                values = decode_values(request["ExpressionAttributeValues"])
                valid = existing and existing.get("owner_id") == values[":owner"]
                if ":consent" in values:
                    valid = valid and existing.get("consent_status") == values[":consent"]
                if ":not_pending" in values:
                    valid = valid and existing.get("deletion_pending", False) == values[":not_pending"]
                item = dict(existing or {})
                field = "photo_count" if request["TableName"] == "people" else "match_count"
                item[field] = item.get(field, 0) + values[":delta"]
                if ":now" in values:
                    item["updated_at"] = values[":now"]
                staged.append((table, item))
            if not valid:
                raise FakeClientError({"Error": {"Code": "TransactionCanceledException"}})
        for table, item in staged:
            table.items[table.item_key(item)] = item
        return {}


fake_s3 = FakeS3()
fake_rekognition = FakeRekognition()
fake_dynamodb = FakeDynamoResource()
fake_transactions = FakeTransactions()


def install_fake_aws_modules() -> None:
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda service: fake_s3 if service == "s3" else fake_transactions if service == "dynamodb" else fake_rekognition
    boto3.resource = lambda _service: fake_dynamodb

    dynamodb_module = types.ModuleType("boto3.dynamodb")
    conditions_module = types.ModuleType("boto3.dynamodb.conditions")
    conditions_module.Key = FakeKey
    types_module = types.ModuleType("boto3.dynamodb.types")
    types_module.TypeSerializer = FakeSerializer

    botocore = types.ModuleType("botocore")
    exceptions_module = types.ModuleType("botocore.exceptions")
    exceptions_module.ClientError = FakeClientError

    sys.modules["boto3"] = boto3
    sys.modules["boto3.dynamodb"] = dynamodb_module
    sys.modules["boto3.dynamodb.conditions"] = conditions_module
    sys.modules["boto3.dynamodb.types"] = types_module
    sys.modules["botocore"] = botocore
    sys.modules["botocore.exceptions"] = exceptions_module


def load_app_module():
    install_fake_aws_modules()
    os.environ.update(
        {
            "BUCKET_NAME": "test-bucket",
            "COLLECTION_ID": "test-collection",
            "EVENTS_TABLE": "events",
            "MATCHES_TABLE": "matches",
            "PEOPLE_TABLE": "people",
            "PHOTOS_TABLE": "photos",
            "UPLOADS_TABLE": "uploads",
        }
    )

    app_path = Path(__file__).resolve().parents[1] / "lambda" / "app.py"
    spec = importlib.util.spec_from_file_location("faceid_lambda_app", app_path)
    if not spec or not spec.loader:
        raise RuntimeError("Could not load Lambda app module.")
    module = importlib.util.module_from_spec(spec)
    sys.modules["faceid_lambda_app"] = module
    spec.loader.exec_module(module)
    return module


app = load_app_module()


class UploadIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        fake_transactions.calls.clear()
        fake_rekognition.deleted_faces.clear()
        fake_s3.deleted.clear()
        fake_s3.heads.clear()
        for table in fake_dynamodb.tables.values():
            table.deletes.clear()
            table.items.clear()
            table.puts.clear()
            table.updates.clear()

    def test_presign_creates_upload_session_and_metadata_header(self):
        result = app.presign_uploads(
            {
                "files": [
                    {"name": "photo.jpg", "size": 12, "type": "image/jpeg"},
                ],
                "mode": "photos",
            },
            "user-123",
        )

        upload = result["uploads"][0]
        session = app.uploads_table.puts[0]

        self.assertEqual(upload["uploadId"], session["id"])
        self.assertEqual(upload["headers"]["x-amz-meta-upload-id"], session["id"])
        self.assertEqual(session["owner_id"], "user-123")
        self.assertEqual(session["event_id"], app.default_event_id("user-123"))
        self.assertEqual(session["status"], "issued")
        self.assertTrue(
            upload["key"].startswith(
                f"users/user-123/events/{app.default_event_id('user-123')}/photos/"
            )
        )

    def test_validate_processed_files_rejects_keys_outside_user_scope(self):
        with self.assertRaisesRegex(ValueError, "outside the authenticated user scope"):
            app.validate_processed_files(
                [
                    {
                        "key": "users/other/events/event-other-default/photos/2026/05/09/photo.jpg",
                        "name": "photo.jpg",
                        "size": 12,
                        "type": "image/jpeg",
                        "uploadId": "upload-1",
                    }
                ],
                "photos",
                "user-123",
            )

    def test_validate_processed_files_requires_upload_session(self):
        with self.assertRaisesRegex(ValueError, "upload session ID"):
            app.validate_processed_files(
                [
                    {
                        "key": "users/user-123/photos/2026/05/09/photo.jpg",
                        "name": "photo.jpg",
                        "size": 12,
                        "type": "image/jpeg",
                    }
                ],
                "photos",
                "user-123",
            )

    def test_validate_processed_files_verifies_session_and_s3_head(self):
        event_id = app.default_event_id("user-123")
        key = f"users/user-123/events/{event_id}/photos/2026/05/09/photo.jpg"
        app.uploads_table.items["upload-1"] = {
            "content_type": "image/jpeg",
            "event_id": event_id,
            "expires_at": 4_102_444_800,
            "id": "upload-1",
            "key": key,
            "mode": "photos",
            "name": "photo.jpg",
            "owner_id": "user-123",
            "size": 12,
            "status": "issued",
        }
        fake_s3.heads[key] = {
            "ContentLength": 12,
            "ContentType": "image/jpeg",
            "Metadata": {"upload-id": "upload-1"},
        }

        files = app.validate_processed_files(
            [
                {
                    "key": key,
                    "name": "photo.jpg",
                    "size": 12,
                    "type": "image/jpeg",
                    "uploadId": "upload-1",
                }
            ],
            "photos",
            "user-123",
        )

        self.assertEqual(files[0]["uploadId"], "upload-1")
        self.assertEqual(files[0]["size"], 12)
        self.assertEqual(files[0]["type"], "image/jpeg")

    def test_handler_requires_authenticated_user_context(self):
        with patch("builtins.print"):
            response = app.handler(
                {
                    "rawPath": "/library",
                    "requestContext": {"http": {"method": "GET"}},
                },
                None,
            )

        self.assertEqual(response["statusCode"], 401)
        self.assertEqual(
            json.loads(response["body"])["message"],
            "Authenticated user context is required.",
        )

    def test_get_library_filters_people_photos_and_matches_by_event(self):
        event_a = app.create_event({"name": "Spring Gala"}, "user-123")
        event_b = app.create_event({"name": "Roadshow"}, "user-123")
        app.people_table.items["person-a"] = {
            "event_id": event_a["id"],
            "id": "person-a",
            "name": "Jane Doe",
            "owner_id": "user-123",
        }
        app.people_table.items["person-b"] = {
            "event_id": event_b["id"],
            "id": "person-b",
            "name": "Other Guest",
            "owner_id": "user-123",
        }
        app.photos_table.items["photo-a"] = {
            "event_id": event_a["id"],
            "id": "photo-a",
            "key": "users/user-123/events/event-a/photos/photo.jpg",
            "name": "photo-a.jpg",
            "owner_id": "user-123",
            "uploaded_at": "2026-05-11T00:00:00Z",
        }
        app.photos_table.items["photo-b"] = {
            "event_id": event_b["id"],
            "id": "photo-b",
            "key": "users/user-123/events/event-b/photos/photo.jpg",
            "name": "photo-b.jpg",
            "owner_id": "user-123",
            "uploaded_at": "2026-05-11T00:00:00Z",
        }
        app.matches_table.items["photo-a:person-a"] = {
            "confidence": 82,
            "event_id": event_a["id"],
            "owner_id": "user-123",
            "person_id": "person-a",
            "person_name": "Jane Doe",
            "photo_id": "photo-a",
            "status": "review",
        }

        result = app.get_library("user-123", event_a["id"])

        self.assertEqual(result["event"]["id"], event_a["id"])
        self.assertEqual([person["id"] for person in result["people"]], ["person-a"])
        self.assertEqual([photo["id"] for photo in result["photos"]], ["photo-a"])
        self.assertEqual(result["photos"][0]["matches"][0]["status"], "needs_review")
        self.assertEqual(result["event"]["reviewCount"], 1)

    def test_update_match_status_records_human_decision(self):
        app.matches_table.items["photo-1:person-1"] = {
            "confidence": 82,
            "owner_id": "user-123",
            "person_id": "person-1",
            "person_name": "Jane Doe",
            "photo_id": "photo-1",
            "status": "needs_review",
        }

        result = app.update_match_status(
            "photo-1", "person-1", {"status": "approved"}, "user-123"
        )

        self.assertEqual(result["status"], "approved")
        self.assertEqual(app.matches_table.items["photo-1:person-1"]["status"], "approved")

    def test_update_match_status_rejects_and_decrements_counts(self):
        app.matches_table.items["photo-1:person-1"] = {
            "confidence": 82,
            "owner_id": "user-123",
            "person_id": "person-1",
            "person_name": "Jane Doe",
            "photo_id": "photo-1",
            "status": "needs_review",
        }

        app.update_match_status("photo-1", "person-1", {"status": "rejected"}, "user-123")

        self.assertEqual(app.matches_table.items["photo-1:person-1"]["status"], "rejected")
        self.assertEqual(app.people_table.updates[0]["Key"]["id"], "person-1")
        self.assertEqual(app.photos_table.updates[0]["Key"]["id"], "photo-1")

    def test_delete_photo_removes_owned_photo_matches_and_s3_object(self):
        app.photos_table.items["photo-1"] = {
            "id": "photo-1",
            "key": "users/user-123/photos/photo.jpg",
            "owner_id": "user-123",
        }
        app.matches_table.items["photo-1:person-1"] = {
            "owner_id": "user-123",
            "person_id": "person-1",
            "photo_id": "photo-1",
        }

        result = app.delete_photo("photo-1", "user-123")

        self.assertEqual(result["deletedPhotoId"], "photo-1")
        self.assertEqual(result["deletedMatches"], 1)
        self.assertEqual(fake_s3.deleted[0]["Key"], "users/user-123/photos/photo.jpg")
        self.assertEqual(app.matches_table.deletes[0]["Key"]["photo_id"], "photo-1")
        self.assertEqual(app.photos_table.deletes[0]["Key"]["id"], "photo-1")
        self.assertEqual(app.people_table.updates[0]["Key"]["id"], "person-1")

    def test_delete_person_removes_references_faces_and_matches(self):
        app.people_table.items["person-1"] = {
            "face_ids": ["face-1"],
            "id": "person-1",
            "owner_id": "user-123",
            "reference_keys": ["users/user-123/references/jane.jpg"],
        }
        app.matches_table.items["photo-1:person-1"] = {
            "owner_id": "user-123",
            "person_id": "person-1",
            "photo_id": "photo-1",
        }

        result = app.delete_person("person-1", "user-123")

        self.assertEqual(result["deletedPersonId"], "person-1")
        self.assertEqual(result["deletedMatches"], 1)
        self.assertEqual(result["deletedReferenceImages"], 1)
        self.assertEqual(fake_rekognition.deleted_faces[0]["FaceIds"], ["face-1"])
        self.assertEqual(fake_s3.deleted[0]["Key"], "users/user-123/references/jane.jpg")
        self.assertEqual(app.matches_table.deletes[0]["Key"]["person_id"], "person-1")
        self.assertEqual(app.people_table.deletes[0]["Key"]["id"], "person-1")

    def prepare_reference_request(self, guest_name="Jane McDonald", count=1, person_id=None):
        payload = {
            "files": [{"name": f"IMG_{index}.jpg", "size": 12, "type": "image/jpeg"} for index in range(count)],
            "guestName": guest_name,
            "mode": "references",
        }
        if person_id:
            payload["personId"] = person_id
        uploads = app.presign_uploads(payload, "user-123")["uploads"]
        payload["files"] = []
        for upload in uploads:
            fake_s3.heads[upload["key"]] = {
                "ContentLength": 12, "ContentType": "image/jpeg",
                "Metadata": {"upload-id": upload["uploadId"]},
            }
            payload["files"].append({
                "name": upload["name"], "key": upload["key"],
                "uploadId": upload["uploadId"], "size": 12, "type": "image/jpeg",
            })
        payload["consent"] = {"confirmed": True, "source": "owner_attested"}
        return payload

    def test_named_references_preserve_name_and_return_one_authoritative_profile(self):
        payload = self.prepare_reference_request("Jane McDonald", count=2)
        result = app.process_uploads(payload, "user-123")

        self.assertEqual(len(result["people"]), 1)
        person = result["people"][0]
        self.assertEqual(person["name"], "Jane McDonald")
        self.assertEqual(person["referenceCount"], 2)
        self.assertEqual(person["consentSource"], "owner_attested")
        self.assertTrue(person["consentCapturedAt"])
        self.assertIn(payload["files"][0]["key"], person["referencePreviewUrl"])

    def test_same_name_submissions_are_distinct_people(self):
        first = app.process_uploads(self.prepare_reference_request(), "user-123")
        second = app.process_uploads(self.prepare_reference_request(), "user-123")
        self.assertNotEqual(first["people"][0]["id"], second["people"][0]["id"])

    def test_named_references_support_non_latin_names(self):
        name = "\uc774 \uc9c0\uc6b0"
        result = app.process_uploads(self.prepare_reference_request(name), "user-123")
        self.assertEqual(result["people"][0]["name"], name)

    def test_single_character_guest_name_is_supported(self):
        name = "\u674e"
        result = app.process_uploads(self.prepare_reference_request(name), "user-123")
        self.assertEqual(result["people"][0]["name"], name)

    def test_processing_cannot_change_guest_bound_to_upload_session(self):
        payload = self.prepare_reference_request()
        payload["guestName"] = "Another Guest"
        with patch.object(fake_rekognition, "index_faces") as index_faces:
            with self.assertRaisesRegex(ValueError, "issued upload session"):
                app.process_uploads(payload, "user-123")
            index_faces.assert_not_called()

    def test_existing_guest_reference_cannot_cross_owner_or_event(self):
        event_a = app.create_event({"name": "Event A"}, "user-123")
        event_b = app.create_event({"name": "Event B"}, "user-123")
        app.people_table.items["person-1"] = {
            "id": "person-1", "owner_id": "another-user", "event_id": event_a["id"], "name": "Jane Doe",
        }
        payload = {"mode": "references", "eventId": event_a["id"], "personId": "person-1",
                   "files": [{"name": "photo.jpg", "size": 12, "type": "image/jpeg"}]}
        with self.assertRaisesRegex(LookupError, "Guest was not found"):
            app.presign_uploads(payload, "user-123")
        app.people_table.items["person-1"]["owner_id"] = "user-123"
        payload["eventId"] = event_b["id"]
        with self.assertRaisesRegex(ValueError, "selected event"):
            app.presign_uploads(payload, "user-123")

    def test_add_reference_updates_existing_guest_without_adding_cumulative_counts(self):
        first = app.process_uploads(self.prepare_reference_request(), "user-123")["people"][0]
        result = app.process_uploads(self.prepare_reference_request(person_id=first["id"]), "user-123")
        self.assertEqual(result["people"][0]["id"], first["id"])
        self.assertEqual(result["people"][0]["referenceCount"], 2)

    def test_named_reference_limit_is_enforced_before_issuing_uploads(self):
        with self.assertRaisesRegex(ValueError, "at most 2 reference"):
            self.prepare_reference_request(count=3)
        self.assertEqual(app.uploads_table.puts, [])

    def test_deleted_guest_cannot_be_recreated_by_pending_reference_session(self):
        first = app.process_uploads(self.prepare_reference_request(), "user-123")["people"][0]
        payload = self.prepare_reference_request(person_id=first["id"])
        app.people_table.items.pop(first["id"])
        with patch.object(fake_rekognition, "index_faces") as index_faces:
            with self.assertRaisesRegex(LookupError, "Guest was not found"):
                app.process_uploads(payload, "user-123")
            index_faces.assert_not_called()

    def test_no_face_reference_reports_outcome_and_removes_unusable_image(self):
        payload = self.prepare_reference_request()
        with patch.object(fake_rekognition, "index_faces", return_value={"FaceRecords": []}):
            result = app.process_uploads(payload, "user-123")
        self.assertEqual(result["people"], [])
        self.assertIn("No clear face found", result["warnings"][0])
        self.assertEqual(fake_s3.deleted[0]["Key"], payload["files"][0]["key"])
        self.assertEqual(app.people_table.items, {})

    def test_unsupported_and_empty_files_are_rejected(self):
        for image_type in ("image/heic", "image/webp", "application/octet-stream"):
            with self.subTest(image_type=image_type):
                with self.assertRaisesRegex(ValueError, "JPEG or PNG"):
                    app.validate_files([{"name": "photo", "size": 12, "type": image_type}])
        with self.assertRaisesRegex(ValueError, "empty"):
            app.validate_files([{"name": "photo.jpg", "size": 0, "type": "image/jpeg"}])

    def test_owner_cannot_record_guest_submitted_consent(self):
        with self.assertRaisesRegex(ValueError, "owner-attested"):
            app.validate_reference_consent({"confirmed": True, "source": "guest_submitted"})

    def test_matching_does_not_silently_skip_guests_over_limit(self):
        people = [{"id": f"person-{index}", "name": f"Guest {index}", "consent_status": "captured"} for index in range(app.MAX_COMPARE_PEOPLE + 1)]
        with patch.object(app, "query_owner_event_items", return_value=people):
            with patch.object(fake_rekognition, "compare_faces") as compare_faces:
                with self.assertRaisesRegex(ValueError, "matching limit"):
                    app.process_photo_files([], "user-123", "event-1")
                compare_faces.assert_not_called()

    def test_review_count_includes_all_unconfirmed_candidates(self):
        photos = [{"matches": [{"status": status} for status in ("matched", "needs_review", "approved", "rejected")]}]
        self.assertEqual(app.count_review_matches(photos), 2)

    def prepare_guest_request(self, count=1):
        secret = patch.object(app, "INTAKE_TOKEN_SECRET", "test-only-intake-secret")
        secret.start()
        self.addCleanup(secret.stop)
        event = app.ensure_default_event("user-123")
        payload = {"eventId": event["id"], "token": app.sign_intake_token(event["id"]),
                   "guestName": "María Chen", "consent": {"confirmed": True, "source": "guest_submitted"},
                   "files": [{"name": f"camera-{index}.jpg", "size": 12, "type": "image/jpeg"} for index in range(count)]}
        uploads = app.presign_guest_references(payload)["uploads"]
        payload["files"] = [{**file, "key": upload["key"], "uploadId": upload["uploadId"]}
                            for file, upload in zip(payload["files"], uploads)]
        for upload in uploads:
            fake_s3.heads[upload["key"]] = {"ContentLength": 12, "ContentType": "image/jpeg",
                                          "Metadata": {"upload-id": upload["uploadId"]}}
        return payload

    def test_guest_metadata_requires_event_capability_and_exposes_no_owner_data(self):
        payload = self.prepare_guest_request()
        self.assertEqual(app.get_guest_intake(payload), {"eventId": payload["eventId"], "eventName": "Default Event",
                                                        "hostName": "", "contactEmail": "", "signupOpen": True})
        for token in ("wrong", "0" * 64, "非" * 64):
            with self.subTest(token=token):
                with self.assertRaises(LookupError):
                    app.get_guest_intake({**payload, "token": token})
        with self.assertRaises(LookupError):
            app.get_guest_intake({**payload, "eventId": "another-event"})

    def test_guest_intake_link_is_owner_scoped_and_preserves_legacy_url(self):
        payload = self.prepare_guest_request()
        link = app.get_event_intake_link(payload["eventId"], "user-123", {})
        self.assertIn("/guest?eventId=", link["intakeUrl"])
        self.assertIn(payload["token"], link["intakeUrl"])
        with self.assertRaises(LookupError):
            app.get_event_intake_link(payload["eventId"], "another-owner", {})

    def test_guest_signup_groups_references_and_records_guest_submitted_consent(self):
        result = app.process_guest_references(self.prepare_guest_request(count=2))
        self.assertEqual(len(result["people"]), 1)
        self.assertEqual(result["people"][0]["name"], "María Chen")
        self.assertEqual(result["people"][0]["referenceCount"], 2)
        self.assertEqual(result["people"][0]["consentSource"], "guest_submitted")

    def test_guest_signup_rejects_changed_names_and_owner_upload_sessions(self):
        payload = self.prepare_guest_request()
        with patch.object(fake_rekognition, "index_faces") as index_faces:
            with self.assertRaisesRegex(ValueError, "guest signup"):
                app.process_guest_references({**payload, "guestName": "Someone else"})
            session = app.uploads_table.items[payload["files"][0]["uploadId"]]
            session.pop("intake_source")
            with self.assertRaisesRegex(ValueError, "guest signup"):
                app.process_guest_references(payload)
            index_faces.assert_not_called()

    def test_guest_signup_accepts_sessions_issued_by_the_previous_deployment(self):
        payload = self.prepare_guest_request(count=2)
        for file in payload["files"]:
            session = app.uploads_table.items[file["uploadId"]]
            session.pop("person_id")
            session.pop("intake_source")
        result = app.process_guest_references(payload)
        self.assertEqual(len(result["people"]), 1)
        self.assertEqual(result["people"][0]["name"], payload["guestName"])
        self.assertEqual(result["people"][0]["referenceCount"], 2)

    def test_guest_signup_requires_its_own_consent_and_reference_mode(self):
        payload = self.prepare_guest_request()
        with self.assertRaisesRegex(ValueError, "guest-submitted"):
            app.process_guest_references({**payload, "consent": {"confirmed": True, "source": "owner_attested"}})
        session = app.uploads_table.items[payload["files"][0]["uploadId"]]
        session["mode"] = "photos"
        with self.assertRaisesRegex(ValueError, "requested file"):
            app.process_guest_references(payload)

    def test_guest_signup_cannot_exceed_the_reference_limit(self):
        payload = self.prepare_guest_request()
        files = [{"name": f"photo-{index}.jpg", "size": 12, "type": "image/jpeg"} for index in range(app.MAX_REFS_PER_PERSON + 1)]
        with self.assertRaisesRegex(ValueError, "at most"):
            app.presign_guest_references({**payload, "files": files})

    def test_event_details_are_owner_scoped_and_public_fields_are_explicit(self):
        payload = self.prepare_guest_request()
        settings = {"name": "Harper wedding", "hostName": "Harper Studio", "contactEmail": "hello@example.com"}
        with self.assertRaises(LookupError):
            app.update_event(payload["eventId"], settings, "another-owner")
        result = app.update_event(payload["eventId"], settings, "user-123")
        self.assertEqual(result["hostName"], "Harper Studio")
        self.assertEqual(app.get_guest_intake(payload), {"eventId": payload["eventId"], "eventName": "Harper wedding",
                                                        "hostName": "Harper Studio", "contactEmail": "hello@example.com", "signupOpen": True})

    def test_event_settings_validate_contact_and_boolean(self):
        event = app.ensure_default_event("user-123")
        for invalid in ({"contactEmail": "not-email"}, {"contactEmail": "a@b.c\r\nBcc:x@y.z"},
                        {"hostName": "a\nb"}, {"signupOpen": "false"}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                app.update_event(event["id"], invalid, "user-123")

    def test_closed_signup_blocks_uploads_and_reopen_invalidates_old_links(self):
        payload = self.prepare_guest_request()
        app.update_event(payload["eventId"], {"signupOpen": False}, "user-123")
        self.assertFalse(app.get_guest_intake(payload)["signupOpen"])
        with self.assertRaisesRegex(ValueError, "closed"):
            app.process_guest_references(payload)
        with self.assertRaisesRegex(ValueError, "closed"):
            app.presign_guest_references(payload)
        with self.assertRaisesRegex(ValueError, "closed"):
            app.get_event_intake_link(payload["eventId"], "user-123", {})
        app.update_event(payload["eventId"], {"signupOpen": True}, "user-123")
        with self.assertRaises(LookupError):
            app.get_guest_intake(payload)
        link = app.get_event_intake_link(payload["eventId"], "user-123", {})
        self.assertNotEqual(link["token"], payload["token"])
        self.assertTrue(app.get_guest_intake({**payload, "token": link["token"]})["signupOpen"])

    def test_stale_settings_cannot_restore_previous_invitation_version(self):
        event = app.ensure_default_event("user-123")
        app.update_event(event["id"], {"signupOpen": False}, "user-123")
        app.update_event(event["id"], {"signupOpen": True}, "user-123")
        conditional_error = FakeClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")
        with patch.object(app.events_table, "update_item", side_effect=conditional_error) as update:
            with self.assertRaisesRegex(ValueError, "changed in another tab"):
                app.update_event(event["id"], {"name": "Changed"}, "user-123")
            expression = update.call_args.kwargs
            self.assertIn("intake_version = :previous_intake_version", expression["ConditionExpression"])
            self.assertIn("signup_open = :previous_signup_open", expression["ConditionExpression"])
            self.assertEqual(expression["ExpressionAttributeValues"][":previous_intake_version"], 1)

    def test_guest_receipt_rejects_empty_or_duplicate_ids(self):
        payload = self.prepare_guest_request()
        upload_id = payload["files"][0]["uploadId"]
        for ids in ([], [""], [upload_id, upload_id], [None]):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                app.get_guest_submission({**payload, "uploadIds": ids})

    def test_guest_receipt_checks_current_state_without_reprocessing(self):
        payload = self.prepare_guest_request(count=2)
        receipt = {**payload, "uploadIds": [file["uploadId"] for file in payload["files"]]}
        self.assertEqual(app.get_guest_submission(receipt)["status"], "pending")
        app.process_guest_references(payload)
        with patch.object(fake_rekognition, "index_faces") as index_faces:
            result = app.get_guest_submission(receipt)
            self.assertEqual(result, {"status": "saved", "referenceCount": 2, "name": "María Chen"})
            index_faces.assert_not_called()

    def test_guest_receipt_does_not_expose_other_events_or_owner_uploads(self):
        payload = self.prepare_guest_request()
        upload_id = payload["files"][0]["uploadId"]
        receipt = {**payload, "uploadIds": [upload_id]}
        for field, value in (("owner_id", "someone-else"), ("event_id", "other-event"), ("intake_source", "owner_attested")):
            original = app.uploads_table.items[upload_id][field]
            app.uploads_table.items[upload_id][field] = value
            with self.subTest(field=field), self.assertRaises(LookupError):
                app.get_guest_submission(receipt)
            app.uploads_table.items[upload_id][field] = original

    def test_guest_partial_receipt_never_suggests_full_resubmission(self):
        payload = self.prepare_guest_request(count=2)
        app.process_guest_references({**payload, "files": payload["files"][:1]})
        app.mark_upload_failed(payload["files"][1]["uploadId"], "test failure")
        result = app.get_guest_submission({**payload, "uploadIds": [file["uploadId"] for file in payload["files"]]})
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["referenceCount"], 1)

    def test_face_box_tracks_the_best_comparison_and_is_optional_for_old_matches(self):
        responses = [{"FaceMatches": [{"Similarity": score, "Face": {"BoundingBox": {"Left": left, "Top": .2, "Width": .2, "Height": .3}}}]}
                     for score, left in ((80, .1), (95, .5))]
        with patch.object(fake_rekognition, "compare_faces", side_effect=responses):
            match = app.find_matches("photo", [{"id": "p", "name": "Guest", "reference_keys": ["ref1", "ref2"]}])[0]
        self.assertEqual(match["confidence"], 95)
        self.assertEqual(match["faceBox"]["left"], .5)
        self.assertNotIn("faceBox", app.normalize_match({"person_id": "p", "person_name": "Guest", "confidence": 90}))
        for invalid in (None, {}, {"Left": float("nan"), "Top": 0, "Width": 1, "Height": 1},
                        {"Left": 2, "Top": 0, "Width": 1, "Height": 1}):
            self.assertIsNone(app.normalize_face_box(invalid))

    def test_download_presign_uses_attachment_and_short_expiry(self):
        with patch.object(fake_s3, "generate_presigned_url", return_value="signed") as sign:
            self.assertEqual(app.signed_download_url("private-key", "María.jpg"), "signed")
            params = sign.call_args.kwargs
            self.assertEqual(params["ExpiresIn"], 300)
            self.assertTrue(params["Params"]["ResponseContentDisposition"].startswith("attachment;"))
            self.assertNotIn("\n", params["Params"]["ResponseContentDisposition"])

    def test_authenticated_download_route_rejects_other_owners(self):
        app.photos_table.items["photo-1"] = {"id": "photo-1", "owner_id": "other", "name": "file.jpg", "key": "secret"}
        event = {"rawPath": "/photos/photo-1/download", "requestContext": {"http": {"method": "GET"},
                 "authorizer": {"jwt": {"claims": {"sub": "user-123"}}}}}
        with patch.object(fake_s3, "generate_presigned_url") as sign:
            self.assertEqual(app.handler(event, None)["statusCode"], 404)
            sign.assert_not_called()


class DeliveryAndCorrectionTests(unittest.TestCase):
    def setUp(self):
        UploadIntegrityTests.setUp(self)

    def fixture(self):
        event = app.ensure_default_event("user-123")
        event.update({"host_name": "Test studio", "contact_email": "studio@example.com"})
        person = {"id": "guest-1", "owner_id": "user-123", "event_id": event["id"], "name": "Guest One",
                  "consent_status": "captured", "reference_keys": ["reference-1", "reference-2"], "reference_count": 2, "photo_count": 0}
        photo = {"id": "photo-1", "owner_id": "user-123", "event_id": event["id"], "name": "event.jpg",
                 "key": "private-event-photo", "uploaded_at": "2026-10-13T00:00:00Z", "match_count": 0}
        app.people_table.items[person["id"]] = person
        app.photos_table.items[photo["id"]] = photo
        return event, person, photo

    def test_manual_assignment_is_atomic_idempotent_and_has_no_fake_score(self):
        event, person, photo = self.fixture()
        payload = {"eventId": event["id"], "personId": person["id"]}
        with patch.object(fake_rekognition, "compare_faces") as compare:
            result = app.assign_photo_guest(photo["id"], payload, "user-123")
            repeat = app.assign_photo_guest(photo["id"], payload, "user-123")
            compare.assert_not_called()
        self.assertEqual(result["source"], "manual")
        self.assertNotIn("confidence", result)
        self.assertEqual(result, repeat)
        self.assertEqual(len(fake_transactions.calls), 1)
        self.assertEqual(app.people_table.items[person["id"]]["photo_count"], 1)
        self.assertEqual(app.photos_table.items[photo["id"]]["match_count"], 1)
        self.assertEqual(app.get_library("user-123", event["id"])["photos"][0]["matches"][0]["source"], "manual")

    def test_correction_refuses_other_owners_events_and_missing_permission(self):
        event, person, photo = self.fixture()
        payload = {"eventId": event["id"], "personId": person["id"]}
        for field, value in (("owner_id", "other-owner"), ("event_id", "other-event"), ("consent_status", "unknown")):
            original = person[field]
            person[field] = value
            with self.subTest(field=field), self.assertRaises((LookupError, ValueError)):
                app.assign_photo_guest(photo["id"], payload, "user-123")
            person[field] = original
        self.assertFalse(fake_transactions.calls)

    def test_deleted_guest_cannot_be_recreated_during_assignment(self):
        event, person, photo = self.fixture()
        original = fake_transactions.transact_write_items
        def race(**kwargs):
            app.people_table.items.pop(person["id"])
            return original(**kwargs)
        with patch.object(fake_transactions, "transact_write_items", side_effect=race):
            with self.assertRaisesRegex(ValueError, "changed while saving"):
                app.assign_photo_guest(photo["id"], {"eventId": event["id"], "personId": person["id"]}, "user-123")
        self.assertFalse(app.matches_table.items)
        self.assertEqual(app.photos_table.items[photo["id"]]["match_count"], 0)

    def test_rematch_is_bounded_and_replays_without_repeating_recognition(self):
        event, person, photo = self.fixture()
        payload = {"eventId": event["id"], "personId": person["id"], "requestId": "rematch-request-0001"}
        response = {"FaceMatches": [{"Similarity": 94, "Face": {"BoundingBox": {"Left": .1, "Top": .2, "Width": .2, "Height": .3}}}]}
        with patch.object(fake_rekognition, "compare_faces", return_value=response) as compare:
            first = app.rematch_photo_guest(photo["id"], payload, "user-123")
            second = app.rematch_photo_guest(photo["id"], payload, "user-123")
            self.assertEqual(compare.call_count, 2)
        self.assertEqual(first, second)
        self.assertEqual(first["match"]["status"], "matched")
        self.assertEqual(first["match"]["source"], "face_match")
        self.assertEqual(len(fake_transactions.calls), 1)
        self.assertEqual(app.people_table.items[person["id"]]["photo_count"], 1)
        with self.assertRaisesRegex(ValueError, "another photo or guest"):
            photo2 = {**photo, "id": "photo-2"}
            app.photos_table.items[photo2["id"]] = photo2
            app.rematch_photo_guest(photo2["id"], payload, "user-123")

    def test_rematch_keeps_reviewed_matches_and_rejects_pending_retries(self):
        event, person, photo = self.fixture()
        payload = {"eventId": event["id"], "personId": person["id"], "requestId": "rematch-request-0002"}
        app.assign_photo_guest(photo["id"], payload, "user-123")
        with patch.object(fake_rekognition, "compare_faces") as compare:
            self.assertEqual(app.rematch_photo_guest(photo["id"], payload, "user-123")["outcome"], "kept_decision")
            app.update_match_status(photo["id"], person["id"], {"status": "rejected"}, "user-123")
            self.assertEqual(app.rematch_photo_guest(photo["id"], payload, "user-123")["outcome"], "kept_decision")
            compare.assert_not_called()
        app.matches_table.items.clear()
        operation_id = "rematch-user-123-" + payload["requestId"]
        app.uploads_table.items[operation_id] = {"id": operation_id, "mode": "rematch", "owner_id": "user-123", "event_id": event["id"], "photo_id": photo["id"], "person_id": person["id"], "status": "processing"}
        with patch.object(fake_rekognition, "compare_faces") as compare, self.assertRaises(BlockingIOError):
            app.rematch_photo_guest(photo["id"], payload, "user-123")
        compare.assert_not_called()

    def test_rematch_does_not_overwrite_a_concurrent_manual_decision(self):
        event, person, photo = self.fixture()
        payload = {"eventId": event["id"], "personId": person["id"], "requestId": "rematch-request-0003"}
        def compare(**kwargs):
            if not app.matches_table.items:
                app.assign_photo_guest(photo["id"], payload, "user-123")
            return {"FaceMatches": [{"Similarity": 95}]}
        with patch.object(fake_rekognition, "compare_faces", side_effect=compare):
            with self.assertRaisesRegex(ValueError, "changed while saving"):
                app.rematch_photo_guest(photo["id"], payload, "user-123")
        match = app.matches_table.items["photo-1:guest-1"]
        self.assertEqual(match["source"], "manual")
        self.assertEqual(match["status"], "approved")
        self.assertEqual(app.people_table.items[person["id"]]["photo_count"], 1)

    def gallery_fixture(self):
        event, person, photo = self.fixture()
        app.assign_photo_guest(photo["id"], {"eventId": event["id"], "personId": person["id"]}, "user-123")
        link = app.create_gallery_link(person["id"], "user-123", {})
        params = {key: values[0] for key, values in parse_qs(urlparse(link["galleryUrl"]).query).items()}
        return event, app.people_table.items[person["id"]], app.photos_table.items[photo["id"]], link, params

    def test_gallery_exposes_only_approved_photos_not_references_or_other_guests(self):
        event, person, photo, link, params = self.gallery_fixture()
        self.assertNotIn(params["token"], json.dumps(app.people_table.items, default=str))
        app.photos_table.items["photo-unapproved"] = {**photo, "id": "photo-unapproved", "key": "unapproved-private"}
        app.matches_table.items["photo-unapproved:guest-1"] = {"photo_id": "photo-unapproved", "person_id": person["id"], "owner_id": "user-123", "event_id": event["id"], "status": "needs_review"}
        app.people_table.items["guest-2"] = {**person, "id": "guest-2", "name": "Another Guest", "reference_keys": ["other-private-reference"]}
        result = app.get_guest_gallery(params)
        self.assertEqual(result["guestName"], person["name"])
        self.assertEqual([item["id"] for item in result["photos"]], [photo["id"]])
        self.assertNotIn("matches", result["photos"][0])
        self.assertNotIn("referencePreviewUrl", result)
        self.assertNotIn("guest-2", json.dumps(result))
        with patch.object(fake_s3, "generate_presigned_url", return_value="download") as sign:
            self.assertEqual(app.get_gallery_download(photo["id"], params)["url"], "download")
            self.assertEqual(sign.call_args.kwargs["ExpiresIn"], 300)
        for field, value in (("token", "x" * 43), ("personId", "guest-2")):
            with self.subTest(field=field), self.assertRaises(LookupError):
                app.get_guest_gallery({**params, field: value})

    def test_gallery_rejects_cross_owner_and_event_photo_records(self):
        event, person, photo, link, params = self.gallery_fixture()
        for field, value in (("owner_id", "other-owner"), ("event_id", "other-event")):
            original = photo[field]
            photo[field] = value
            self.assertEqual(app.get_guest_gallery(params)["photos"], [])
            with self.assertRaises(LookupError):
                app.get_gallery_download(photo["id"], params)
            photo[field] = original

    def test_gallery_rechecks_approval_even_when_index_is_stale(self):
        event, person, photo, link, params = self.gallery_fixture()
        stale = dict(app.matches_table.items["photo-1:guest-1"])
        app.matches_table.items["photo-1:guest-1"]["status"] = "rejected"
        with patch.object(app.matches_table, "query", return_value={"Items": [stale]}):
            self.assertEqual(app.get_guest_gallery(params)["photos"], [])
        with self.assertRaises(LookupError):
            app.get_gallery_download(photo["id"], params)

    def test_gallery_link_rotation_disable_expiry_and_guest_deletion(self):
        event, person, photo, link, params = self.gallery_fixture()
        replacement = app.create_gallery_link(person["id"], "user-123", {})
        new_params = {key: values[0] for key, values in parse_qs(urlparse(replacement["galleryUrl"]).query).items()}
        with self.assertRaises(LookupError):
            app.get_guest_gallery(params)
        self.assertEqual(len(app.get_guest_gallery(new_params)["photos"]), 1)
        app.disable_gallery_link(person["id"], "user-123")
        with self.assertRaises(LookupError):
            app.get_gallery_download(photo["id"], new_params)
        app.people_table.items[person["id"]]["gallery_enabled"] = True
        app.people_table.items[person["id"]]["gallery_expires_at"] = 1
        with self.assertRaises(LookupError):
            app.get_guest_gallery(new_params)
        app.people_table.items.pop(person["id"])
        with self.assertRaises(LookupError):
            app.get_guest_gallery(new_params)

    def test_gallery_creation_requires_owner_permission_and_an_approval(self):
        event, person, photo = self.fixture()
        with self.assertRaises(LookupError):
            app.create_gallery_link(person["id"], "other-owner", {})
        with self.assertRaisesRegex(ValueError, "Approve"):
            app.create_gallery_link(person["id"], "user-123", {})
        person["consent_status"] = "unknown"
        with self.assertRaisesRegex(ValueError, "permission"):
            app.create_gallery_link(person["id"], "user-123", {})

    def test_gallery_can_open_a_just_approved_photo_before_index_propagation(self):
        event, person, photo = self.fixture()
        app.assign_photo_guest(photo["id"], {"eventId": event["id"], "personId": person["id"]}, "user-123")
        with patch.object(app.matches_table, "query", return_value={"Items": []}):
            link = app.create_gallery_link(person["id"], "user-123", {}, {"photoId": photo["id"]})
            params = {key: values[0] for key, values in parse_qs(urlparse(link["galleryUrl"]).query).items()}
            self.assertEqual([item["id"] for item in app.get_guest_gallery(params)["photos"]], [photo["id"]])
            app.update_match_status(photo["id"], person["id"], {"status": "rejected"}, "user-123")
            self.assertEqual(app.get_guest_gallery(params)["photos"], [])

    def test_reference_upload_cannot_restore_a_guest_removed_during_indexing(self):
        event, person, photo = self.fixture()
        file = {"personId": person["id"], "personName": person["name"], "existingPerson": True,
                "key": "new-reference", "name": "reference.jpg", "uploadId": "upload-race"}
        def index(**kwargs):
            app.people_table.items.pop(person["id"])
            return {"FaceRecords": [{"Face": {"FaceId": "new-face"}}]}
        consent = {"consentStatus": "captured", "consentSource": "owner_attested", "consentCapturedAt": app.iso_now()}
        with patch.object(app, "claim_upload_session"), patch.object(fake_rekognition, "index_faces", side_effect=index):
            with self.assertRaisesRegex(ValueError, "guest changed"):
                app.process_reference_files([file], "user-123", event["id"], consent)
        self.assertNotIn(person["id"], app.people_table.items)
        self.assertEqual(fake_rekognition.deleted_faces[-1]["FaceIds"], ["new-face"])
        self.assertEqual(fake_s3.deleted[-1]["Key"], "new-reference")

    def test_concurrent_reference_upload_cannot_exceed_the_limit(self):
        event, person, photo = self.fixture()
        person.update(reference_count=1, face_ids=["existing-face"])
        file = {"personId": person["id"], "personName": person["name"], "existingPerson": True,
                "key": "new-reference", "name": "reference.jpg", "uploadId": "upload-limit"}
        def index(**kwargs):
            person.update(reference_count=app.MAX_REFS_PER_PERSON, face_ids=["existing-face", "concurrent-face"])
            return {"FaceRecords": [{"Face": {"FaceId": "existing-face"}}, {"Face": {"FaceId": "new-face"}}]}
        consent = {"consentStatus": "captured", "consentSource": "owner_attested", "consentCapturedAt": app.iso_now()}
        with patch.object(app, "claim_upload_session"), patch.object(fake_rekognition, "index_faces", side_effect=index):
            with self.assertRaisesRegex(ValueError, "reference limit"):
                app.process_reference_files([file], "user-123", event["id"], consent)
        self.assertEqual(person["reference_count"], app.MAX_REFS_PER_PERSON)
        self.assertEqual(person["face_ids"], ["existing-face", "concurrent-face"])
        self.assertEqual(fake_rekognition.deleted_faces[-1]["FaceIds"], ["new-face"])

    def test_failed_guest_removal_disables_gallery_and_is_retryable(self):
        event, person, photo, link, params = self.gallery_fixture()
        person["face_ids"] = ["face-1"]
        with patch.object(fake_rekognition, "delete_faces", side_effect=RuntimeError("cleanup failed")):
            with self.assertRaises(RuntimeError):
                app.delete_person(person["id"], "user-123")
        self.assertTrue(app.normalize_person(person)["deletionPending"])
        self.assertFalse(person["gallery_enabled"])
        with self.assertRaises(LookupError):
            app.get_guest_gallery(params)
        with self.assertRaises(ValueError):
            app.assign_photo_guest(photo["id"], {"eventId": event["id"], "personId": person["id"]}, "user-123")
        app.delete_person(person["id"], "user-123")
        self.assertNotIn(person["id"], app.people_table.items)

    def test_photo_upload_does_not_restore_a_guest_removed_during_matching(self):
        event, person, photo = self.fixture()
        file = {"key": "new-event-photo", "name": "new.jpg", "size": 12, "uploadId": "upload-photo-race"}
        def match(*args):
            app.people_table.items.pop(person["id"])
            return [{"personId": person["id"], "personName": person["name"], "confidence": 95, "status": "matched"}]
        with patch.object(app, "claim_upload_session"), patch.object(app, "find_matches", side_effect=match):
            result = app.process_photo_files([file], "user-123", event["id"])
        self.assertEqual(result["photos"][0]["matches"], [])
        self.assertNotIn(person["id"], app.people_table.items)
        self.assertFalse(app.matches_table.items)

    def test_review_and_cleanup_counters_cannot_recreate_deleted_records(self):
        for adjust in (app.increment_person_photo_count, app.decrement_person_photo_count,
                       app.increment_photo_match_count, app.decrement_photo_match_count):
            adjust("already-deleted")
        self.assertNotIn("already-deleted", app.people_table.items)
        self.assertNotIn("already-deleted", app.photos_table.items)

    def test_new_owner_routes_cannot_be_called_anonymously(self):
        for method, path in (("POST", "/photos/photo-1/guests"), ("POST", "/photos/photo-1/rematch"), ("POST", "/people/guest-1/gallery-link"), ("DELETE", "/people/guest-1/gallery-link")):
            with self.subTest(path=path):
                event = {"rawPath": path, "requestContext": {"http": {"method": method}}}
                self.assertEqual(app.handler(event, None)["statusCode"], 401)


if __name__ == "__main__":
    unittest.main()
