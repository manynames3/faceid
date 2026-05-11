import importlib.util
import json
import os
import sys
import types
import unittest
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

    def put_item(self, Item: dict[str, Any]):
        self.puts.append(Item)
        self.items[Item["id"]] = Item
        return {}

    def get_item(self, Key: dict[str, str]):
        item = self.items.get(Key["id"])
        return {"Item": item} if item else {}

    def update_item(self, **kwargs: Any):
        self.updates.append(kwargs)
        return {"Attributes": {"id": kwargs["Key"]["id"], "name": "Jane Doe"}}

    def delete_item(self, **kwargs: Any):
        self.deletes.append(kwargs)
        key = kwargs["Key"]
        if "id" in key:
            self.items.pop(key["id"], None)
        else:
            self.items.pop(f"{key['photo_id']}:{key['person_id']}", None)
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


class FakeDynamoResource:
    def __init__(self):
        self.tables: dict[str, FakeTable] = {}

    def Table(self, name: str) -> FakeTable:
        self.tables.setdefault(name, FakeTable(name))
        return self.tables[name]


fake_s3 = FakeS3()
fake_rekognition = FakeRekognition()
fake_dynamodb = FakeDynamoResource()


def install_fake_aws_modules() -> None:
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda service: fake_s3 if service == "s3" else fake_rekognition
    boto3.resource = lambda _service: fake_dynamodb

    dynamodb_module = types.ModuleType("boto3.dynamodb")
    conditions_module = types.ModuleType("boto3.dynamodb.conditions")
    conditions_module.Key = FakeKey

    botocore = types.ModuleType("botocore")
    exceptions_module = types.ModuleType("botocore.exceptions")
    exceptions_module.ClientError = FakeClientError

    sys.modules["boto3"] = boto3
    sys.modules["boto3.dynamodb"] = dynamodb_module
    sys.modules["boto3.dynamodb.conditions"] = conditions_module
    sys.modules["botocore"] = botocore
    sys.modules["botocore.exceptions"] = exceptions_module


def load_app_module():
    install_fake_aws_modules()
    os.environ.update(
        {
            "BUCKET_NAME": "test-bucket",
            "COLLECTION_ID": "test-collection",
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
        self.assertEqual(session["status"], "issued")
        self.assertTrue(upload["key"].startswith("users/user-123/photos/"))

    def test_validate_processed_files_rejects_keys_outside_user_scope(self):
        with self.assertRaisesRegex(ValueError, "outside the authenticated user scope"):
            app.validate_processed_files(
                [
                    {
                        "key": "users/other/photos/2026/05/09/photo.jpg",
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
        key = "users/user-123/photos/2026/05/09/photo.jpg"
        app.uploads_table.items["upload-1"] = {
            "content_type": "image/jpeg",
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


if __name__ == "__main__":
    unittest.main()
