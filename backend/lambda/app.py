import base64
import json
import os
import re
import time
import uuid
from decimal import Decimal
from typing import Any
from urllib.parse import unquote

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


BUCKET_NAME = os.environ["BUCKET_NAME"]
EVENTS_TABLE = os.environ["EVENTS_TABLE"]
PEOPLE_TABLE = os.environ["PEOPLE_TABLE"]
PHOTOS_TABLE = os.environ["PHOTOS_TABLE"]
MATCHES_TABLE = os.environ["MATCHES_TABLE"]
UPLOADS_TABLE = os.environ["UPLOADS_TABLE"]
COLLECTION_ID = os.environ["COLLECTION_ID"]
EVENTS_OWNER_INDEX = os.environ.get("EVENTS_OWNER_INDEX", "owner_id-created_at-index")
PEOPLE_OWNER_INDEX = os.environ.get("PEOPLE_OWNER_INDEX", "owner_id-name-index")
PHOTOS_OWNER_INDEX = os.environ.get("PHOTOS_OWNER_INDEX", "owner_id-uploaded_at-index")
MATCHES_OWNER_INDEX = os.environ.get("MATCHES_OWNER_INDEX", "owner_id-photo_id-index")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]
MATCHED_THRESHOLD = float(os.environ.get("MATCHED_THRESHOLD", "90"))
REVIEW_THRESHOLD = float(os.environ.get("REVIEW_THRESHOLD", "75"))
MAX_REFS_PER_PERSON = int(os.environ.get("MAX_REFS_PER_PERSON", "2"))
MAX_COMPARE_PEOPLE = int(os.environ.get("MAX_COMPARE_PEOPLE", "50"))
MAX_FILES_PER_BATCH = int(os.environ.get("MAX_FILES_PER_BATCH", "10"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "15"))
UPLOAD_SESSION_TTL_SECONDS = int(os.environ.get("UPLOAD_SESSION_TTL_SECONDS", "3600"))
URL_EXPIRES_SECONDS = int(os.environ.get("URL_EXPIRES_SECONDS", "3600"))

s3 = boto3.client("s3")
rekognition = boto3.client("rekognition")
dynamodb = boto3.resource("dynamodb")
events_table = dynamodb.Table(EVENTS_TABLE)
people_table = dynamodb.Table(PEOPLE_TABLE)
photos_table = dynamodb.Table(PHOTOS_TABLE)
matches_table = dynamodb.Table(MATCHES_TABLE)
uploads_table = dynamodb.Table(UPLOADS_TABLE)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    started_at = time.perf_counter()
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")
    user_id = ""

    try:
        if method == "OPTIONS":
            result = response(204, {}, event)
        else:
            user_id = get_request_user_id(event)

            if method == "GET" and path == "/events":
                result = response(200, {"events": list_events(user_id)}, event)
            elif method == "POST" and path == "/events":
                result = response(201, {"event": create_event(read_json(event), user_id)}, event)
            elif method == "GET" and path == "/library":
                event_id = get_query_param(event, "eventId")
                result = response(200, get_library(user_id, event_id), event)
            elif method == "POST" and path == "/uploads/presign":
                result = response(200, presign_uploads(read_json(event), user_id), event)
            elif method == "POST" and path == "/uploads/process":
                result = response(200, process_uploads(read_json(event), user_id), event)
            elif method == "PATCH" and path.startswith("/matches/"):
                photo_id, person_id = extract_match_ids(path)
                result = response(
                    200,
                    {
                        "match": update_match_status(
                            photo_id, person_id, read_json(event), user_id
                        )
                    },
                    event,
                )
            elif method == "DELETE" and path.startswith("/photos/"):
                result = response(
                    200,
                    delete_photo(extract_path_id(path, "/photos/"), user_id),
                    event,
                )
            elif method == "DELETE" and path.startswith("/people/"):
                result = response(
                    200,
                    delete_person(extract_path_id(path, "/people/"), user_id),
                    event,
                )
            else:
                result = response(404, {"message": "Route not found"}, event)
    except PermissionError as error:
        result = response(401, {"message": str(error)}, event)
    except LookupError as error:
        result = response(404, {"message": str(error)}, event)
    except ValueError as error:
        result = response(400, {"message": str(error)}, event)
    except ClientError as error:
        log_event("error", "aws_service_call_failed", error=error.response)
        result = response(502, {"message": "AWS service call failed"}, event)
    except Exception as error:
        log_event("error", "unexpected_server_error", error=repr(error))
        result = response(500, {"message": "Unexpected server error"}, event)

    status_code = int(result["statusCode"])
    log_event(
        "info" if status_code < 500 else "error",
        "request_completed",
        authenticated=bool(user_id),
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        method=method,
        path=path,
        request_id=getattr(context, "aws_request_id", ""),
        status_code=status_code,
    )
    return result


def create_event(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
    name = validate_event_name(payload.get("name"))
    now = iso_now()
    event_id = f"event-{s3_owner_prefix(user_id)}-{slugify(name)}-{uuid.uuid4().hex[:8]}"

    event_item = {
        "id": event_id,
        "owner_id": user_id,
        "name": name,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    events_table.put_item(Item=event_item)
    return normalize_event(event_item)


def list_events(user_id: str) -> list[dict[str, Any]]:
    ensure_default_event(user_id)
    events = [
        normalize_event(item)
        for item in query_owner_items(events_table, EVENTS_OWNER_INDEX, user_id)
    ]
    return sorted(events, key=lambda item: item["createdAt"], reverse=True)


def ensure_default_event(user_id: str) -> dict[str, Any]:
    event_id = default_event_id(user_id)
    event = events_table.get_item(Key={"id": event_id}).get("Item")
    if event and event.get("owner_id") == user_id:
        return event

    now = iso_now()
    event = {
        "id": event_id,
        "owner_id": user_id,
        "name": "Default Event",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    events_table.put_item(Item=event)
    return event


def get_owned_event(event_id: str | None, user_id: str) -> dict[str, Any]:
    if not event_id:
        return ensure_default_event(user_id)

    event = events_table.get_item(Key={"id": event_id}).get("Item")
    if not event or event.get("owner_id") != user_id:
        raise LookupError("Event was not found.")
    return event


def validate_event_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "").strip())
    if len(name) < 2:
        raise ValueError("Event name is required.")
    if len(name) > 80:
        raise ValueError("Event name must be 80 characters or fewer.")
    return name


def normalize_event(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "name": item["name"],
        "createdAt": item.get("created_at", ""),
        "status": item.get("status", "active"),
    }


def default_event_id(user_id: str) -> str:
    return f"event-{s3_owner_prefix(user_id)}-default"


def item_event_id(item: dict[str, Any], user_id: str) -> str:
    return str(item.get("event_id") or default_event_id(user_id))


def event_s3_token(event_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", event_id).strip("-") or "event"


def presign_uploads(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
    event = get_owned_event(optional_string(payload.get("eventId")), user_id)
    event_id = event["id"]
    mode = validate_mode(payload.get("mode"))
    files = validate_files(payload.get("files"))
    upload_items = []
    now_prefix = time.strftime("%Y/%m/%d")
    owner_prefix = s3_owner_prefix(user_id)
    issued_at = iso_now()
    expires_at = int(time.time()) + UPLOAD_SESSION_TTL_SECONDS

    for file_item in files:
        upload_id = f"upload-{uuid.uuid4()}"
        content_type = clean_content_type(file_item.get("type"))
        key = (
            f"users/{owner_prefix}/events/{event_s3_token(event_id)}/{mode}/{now_prefix}/"
            f"{uuid.uuid4()}-{safe_filename(file_item['name'])}"
        )
        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": key,
                "ContentType": content_type,
                "Metadata": {"upload-id": upload_id},
            },
            ExpiresIn=900,
            HttpMethod="PUT",
        )
        uploads_table.put_item(
            Item={
                "id": upload_id,
                "owner_id": user_id,
                "event_id": event_id,
                "mode": mode,
                "key": key,
                "name": file_item["name"],
                "size": int(file_item["size"]),
                "content_type": content_type,
                "status": "issued",
                "created_at": issued_at,
                "expires_at": expires_at,
            }
        )
        upload_items.append(
            {
                "name": file_item["name"],
                "uploadId": upload_id,
                "key": key,
                "url": url,
                "headers": {
                    "Content-Type": content_type,
                    "x-amz-meta-upload-id": upload_id,
                },
            }
        )

    return {"uploads": upload_items}


def process_uploads(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
    event = get_owned_event(optional_string(payload.get("eventId")), user_id)
    event_id = event["id"]
    mode = validate_mode(payload.get("mode"))
    files = validate_processed_files(payload.get("files"), mode, user_id, event_id)

    if mode == "references":
        consent = validate_reference_consent(payload.get("consent"))
        return process_reference_files(files, user_id, event_id, consent)

    return process_photo_files(files, user_id, event_id)


def validate_reference_consent(consent: Any) -> dict[str, str]:
    if not isinstance(consent, dict) or consent.get("confirmed") is not True:
        raise ValueError("Reference uploads require confirmed guest consent.")

    source = str(consent.get("source") or "owner_attested").strip()
    if source not in {"owner_attested", "guest_submitted"}:
        raise ValueError("Unsupported consent source.")

    return {
        "consentStatus": "captured",
        "consentSource": source,
        "consentCapturedAt": iso_now(),
    }


def process_reference_files(
    files: list[dict[str, Any]],
    user_id: str,
    event_id: str,
    consent: dict[str, str],
) -> dict[str, Any]:
    people = []
    owner_prefix = s3_owner_prefix(user_id)
    event_token = event_s3_token(event_id)

    for file_item in files:
        claim_upload_session(
            file_item, mode="references", user_id=user_id, event_id=event_id
        )
        try:
            person_name = name_from_filename(file_item["name"])
            person_id = f"person-{owner_prefix}-{event_token}-{slugify(person_name)}"

            indexed = rekognition.index_faces(
                CollectionId=COLLECTION_ID,
                Image={"S3Object": {"Bucket": BUCKET_NAME, "Name": file_item["key"]}},
                ExternalImageId=person_id,
                DetectionAttributes=[],
                MaxFaces=1,
                QualityFilter="AUTO",
            )

            face_ids = [
                record["Face"]["FaceId"]
                for record in indexed.get("FaceRecords", [])
                if record.get("Face", {}).get("FaceId")
            ]

            if not face_ids:
                mark_upload_processed(file_item["uploadId"])
                continue

            now = iso_now()
            updated = people_table.update_item(
                Key={"id": person_id},
                UpdateExpression=(
                    "SET owner_id = :owner_id, event_id = :event_id, #name = :name, "
                    "initials = :initials, updated_at = :now, "
                    "consent_status = :consent_status, consent_source = :consent_source, "
                    "consent_captured_at = :consent_captured_at, "
                    "reference_keys = list_append(if_not_exists(reference_keys, :empty), :keys), "
                    "face_ids = list_append(if_not_exists(face_ids, :empty), :face_ids) "
                    "ADD reference_count :one"
                ),
                ExpressionAttributeNames={"#name": "name"},
                ExpressionAttributeValues={
                    ":owner_id": user_id,
                    ":event_id": event_id,
                    ":name": person_name,
                    ":initials": initials_from_name(person_name),
                    ":now": now,
                    ":consent_status": consent["consentStatus"],
                    ":consent_source": consent["consentSource"],
                    ":consent_captured_at": consent["consentCapturedAt"],
                    ":empty": [],
                    ":keys": [file_item["key"]],
                    ":face_ids": face_ids,
                    ":one": 1,
                },
                ReturnValues="ALL_NEW",
            )
            people.append(normalize_person(updated["Attributes"]))
            mark_upload_processed(file_item["uploadId"])
        except Exception as error:
            mark_upload_failed(file_item["uploadId"], repr(error))
            raise

    return {"people": people, "photos": []}


def process_photo_files(
    files: list[dict[str, Any]], user_id: str, event_id: str
) -> dict[str, Any]:
    people = query_owner_event_items(people_table, PEOPLE_OWNER_INDEX, user_id, event_id)
    people = sorted(people, key=lambda item: item.get("name", ""))[:MAX_COMPARE_PEOPLE]
    photos = []
    owner_prefix = s3_owner_prefix(user_id)

    for file_item in files:
        claim_upload_session(
            file_item, mode="photos", user_id=user_id, event_id=event_id
        )
        try:
            photo_id = f"photo-{owner_prefix}-{event_s3_token(event_id)}-{uuid.uuid4()}"
            now = iso_now()
            matches = find_matches(file_item["key"], people)

            photos_table.put_item(
                Item={
                    "id": photo_id,
                    "owner_id": user_id,
                    "event_id": event_id,
                    "name": file_item["name"],
                    "key": file_item["key"],
                    "size": int(file_item["size"]),
                    "uploaded_at": now,
                    "match_count": len(matches),
                }
            )

            for match in matches:
                matches_table.put_item(
                    Item={
                        "photo_id": photo_id,
                        "person_id": match["personId"],
                        "owner_id": user_id,
                        "event_id": event_id,
                        "person_name": match["personName"],
                        "confidence": Decimal(str(round(match["confidence"], 2))),
                        "status": match["status"],
                        "uploaded_at": now,
                    }
                )
                people_table.update_item(
                    Key={"id": match["personId"]},
                    UpdateExpression="SET updated_at = :now ADD photo_count :one",
                    ExpressionAttributeValues={":one": 1, ":now": now},
                )

            photos.append(
                {
                    "id": photo_id,
                    "name": file_item["name"],
                    "size": int(file_item["size"]),
                    "uploadedAt": now,
                    "previewUrl": signed_get_url(file_item["key"]),
                    "matches": matches,
                }
            )
            mark_upload_processed(file_item["uploadId"])
        except Exception as error:
            mark_upload_failed(file_item["uploadId"], repr(error))
            raise

    return {"people": [], "photos": photos}


def find_matches(photo_key: str, people: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matches = []

    for person in people:
        reference_keys = person.get("reference_keys") or []
        best_similarity = 0.0

        for reference_key in reference_keys[:MAX_REFS_PER_PERSON]:
            compared = rekognition.compare_faces(
                SourceImage={
                    "S3Object": {"Bucket": BUCKET_NAME, "Name": reference_key}
                },
                TargetImage={"S3Object": {"Bucket": BUCKET_NAME, "Name": photo_key}},
                SimilarityThreshold=REVIEW_THRESHOLD,
                QualityFilter="AUTO",
            )
            for face_match in compared.get("FaceMatches", []):
                best_similarity = max(
                    best_similarity, float(face_match.get("Similarity", 0))
                )

        if best_similarity >= REVIEW_THRESHOLD:
            status = "matched" if best_similarity >= MATCHED_THRESHOLD else "needs_review"
            matches.append(
                {
                    "personId": person["id"],
                    "personName": person["name"],
                    "confidence": round(best_similarity, 1),
                    "status": status,
                }
            )

    return sorted(matches, key=lambda item: item["confidence"], reverse=True)


def get_library(user_id: str, event_id: str | None = None) -> dict[str, Any]:
    event = get_owned_event(event_id, user_id)
    active_event_id = event["id"]
    people = [
        normalize_person(item)
        for item in query_owner_event_items(
            people_table, PEOPLE_OWNER_INDEX, user_id, active_event_id
        )
    ]
    raw_photos = query_owner_event_items(
        photos_table,
        PHOTOS_OWNER_INDEX,
        user_id,
        active_event_id,
        scan_forward=False,
    )
    raw_matches = query_owner_event_items(
        matches_table, MATCHES_OWNER_INDEX, user_id, active_event_id
    )
    matches_by_photo: dict[str, list[dict[str, Any]]] = {}

    for item in raw_matches:
        photo_id = item["photo_id"]
        matches_by_photo.setdefault(photo_id, []).append(normalize_match(item))

    photos = []
    for item in raw_photos:
        photos.append(
            {
                "id": item["id"],
                "name": item["name"],
                "size": int(item.get("size") or 0),
                "uploadedAt": item.get("uploaded_at", ""),
                "previewUrl": signed_get_url(item["key"]),
                "matches": sorted(
                    matches_by_photo.get(item["id"], []),
                    key=lambda match: match["confidence"],
                    reverse=True,
                ),
            }
        )

    return {
        "event": {
            **normalize_event(event),
            "guestCount": len(people),
            "photoCount": len(photos),
            "reviewCount": count_review_matches(photos),
        },
        "events": list_events(user_id),
        "people": sorted(people, key=lambda item: item["name"]),
        "photos": sorted(photos, key=lambda item: item["uploadedAt"], reverse=True),
    }


def delete_photo(photo_id: str, user_id: str) -> dict[str, Any]:
    photo = get_owned_item(photos_table, {"id": photo_id}, user_id, "Photo")
    matches = query_all_items(
        matches_table,
        KeyConditionExpression=Key("photo_id").eq(photo_id),
    )

    delete_s3_object(photo["key"])
    deleted_matches = 0

    for match in matches:
        if match.get("owner_id") != user_id:
            continue
        matches_table.delete_item(
            Key={"photo_id": photo_id, "person_id": match["person_id"]}
        )
        if normalize_status(match.get("status")) != "rejected":
            decrement_person_photo_count(match["person_id"])
        deleted_matches += 1

    photos_table.delete_item(
        Key={"id": photo_id},
        ConditionExpression="owner_id = :owner_id",
        ExpressionAttributeValues={":owner_id": user_id},
    )

    return {"deletedPhotoId": photo_id, "deletedMatches": deleted_matches}


def delete_person(person_id: str, user_id: str) -> dict[str, Any]:
    person = get_owned_item(people_table, {"id": person_id}, user_id, "Person")
    face_ids = [face_id for face_id in person.get("face_ids", []) if face_id]
    reference_keys = [key for key in person.get("reference_keys", []) if key]
    matches = query_all_items(
        matches_table,
        IndexName="person_id-photo_id-index",
        KeyConditionExpression=Key("person_id").eq(person_id),
    )

    if face_ids:
        rekognition.delete_faces(CollectionId=COLLECTION_ID, FaceIds=face_ids)

    for key in reference_keys:
        delete_s3_object(key)

    deleted_matches = 0
    for match in matches:
        if match.get("owner_id") != user_id:
            continue
        matches_table.delete_item(
            Key={"photo_id": match["photo_id"], "person_id": person_id}
        )
        if normalize_status(match.get("status")) != "rejected":
            decrement_photo_match_count(match["photo_id"])
        deleted_matches += 1

    people_table.delete_item(
        Key={"id": person_id},
        ConditionExpression="owner_id = :owner_id",
        ExpressionAttributeValues={":owner_id": user_id},
    )

    return {
        "deletedPersonId": person_id,
        "deletedMatches": deleted_matches,
        "deletedReferenceImages": len(reference_keys),
    }


def update_match_status(
    photo_id: str, person_id: str, payload: dict[str, Any], user_id: str
) -> dict[str, Any]:
    status = validate_review_status(payload.get("status"))
    match = get_match_item(photo_id, person_id, user_id)
    previous_status = normalize_status(match.get("status"))
    now = iso_now()

    matches_table.update_item(
        Key={"photo_id": photo_id, "person_id": person_id},
        UpdateExpression=(
            "SET #status = :status, reviewed_at = :reviewed_at, updated_at = :updated_at"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": status,
            ":reviewed_at": now,
            ":updated_at": now,
        },
    )

    if previous_status != "rejected" and status == "rejected":
        decrement_person_photo_count(person_id)
        decrement_photo_match_count(photo_id)
    elif previous_status == "rejected" and status != "rejected":
        increment_person_photo_count(person_id)
        increment_photo_match_count(photo_id)

    return normalize_match({**match, "status": status, "reviewed_at": now})


def get_match_item(photo_id: str, person_id: str, user_id: str) -> dict[str, Any]:
    match = matches_table.get_item(
        Key={"photo_id": photo_id, "person_id": person_id}
    ).get("Item")
    if not match or match.get("owner_id") != user_id:
        raise LookupError("Match was not found.")
    return match


def validate_review_status(value: Any) -> str:
    status = normalize_status(value)
    if status not in {"approved", "rejected"}:
        raise ValueError("status must be approved or rejected.")
    return status


def normalize_status(value: Any) -> str:
    status = str(value or "unknown").strip().lower().replace("-", "_")
    if status == "review":
        return "needs_review"
    if status in {"matched", "needs_review", "approved", "rejected"}:
        return status
    return "unknown"


def normalize_match(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "personId": item["person_id"],
        "personName": item["person_name"],
        "confidence": float(item["confidence"]),
        "status": normalize_status(item.get("status")),
        "reviewedAt": item.get("reviewed_at", ""),
    }


def count_review_matches(photos: list[dict[str, Any]]) -> int:
    return sum(
        1
        for photo in photos
        for match in photo["matches"]
        if match["status"] == "needs_review"
    )


def normalize_person(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "name": item["name"],
        "initials": item.get("initials") or initials_from_name(item["name"]),
        "referenceCount": int(item.get("reference_count") or 0),
        "photoCount": int(item.get("photo_count") or 0),
        "consentStatus": item.get("consent_status", "unknown"),
    }


def validate_files(files: Any) -> list[dict[str, Any]]:
    if not isinstance(files, list) or not files:
        raise ValueError("At least one file is required.")
    if len(files) > MAX_FILES_PER_BATCH:
        raise ValueError(f"Upload at most {MAX_FILES_PER_BATCH} files per batch.")

    cleaned = []
    for file_item in files:
        if not isinstance(file_item, dict):
            raise ValueError("Each file must be an object.")
        name = str(file_item.get("name") or "").strip()
        size = int(file_item.get("size") or 0)
        if not name:
            raise ValueError("Each file needs a name.")
        if size > MAX_UPLOAD_MB * 1024 * 1024:
            raise ValueError(f"{name} exceeds the {MAX_UPLOAD_MB} MB upload limit.")
        cleaned.append({"name": name, "size": size, "type": file_item.get("type")})

    return cleaned


def validate_processed_files(
    files: Any, mode: str, user_id: str, event_id: str | None = None
) -> list[dict[str, Any]]:
    cleaned = validate_files(files)
    active_event_id = event_id or default_event_id(user_id)
    expected_prefix = f"users/{s3_owner_prefix(user_id)}/"
    for index, file_item in enumerate(files):
        upload_id = str(file_item.get("uploadId") or "").strip()
        key = str(file_item.get("key") or "").strip()
        if not upload_id:
            raise ValueError("Each processed file needs an upload session ID.")
        if not key:
            raise ValueError("Each processed file needs an S3 key.")
        if not key.startswith(expected_prefix):
            raise ValueError("Uploaded file key is outside the authenticated user scope.")
        session = validate_upload_session(
            upload_id, key, mode, cleaned[index], user_id, active_event_id
        )
        verified = verify_s3_upload(session)
        cleaned[index]["uploadId"] = upload_id
        cleaned[index]["key"] = key
        cleaned[index]["size"] = verified["size"]
        cleaned[index]["type"] = verified["content_type"]
        cleaned[index]["eventId"] = active_event_id
    return cleaned


def validate_mode(mode: Any) -> str:
    if mode not in {"references", "photos"}:
        raise ValueError("mode must be references or photos.")
    return str(mode)


def clean_content_type(value: Any) -> str:
    content_type = str(value or "application/octet-stream")
    if not content_type.startswith("image/"):
        return "application/octet-stream"
    return content_type


def read_json(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object.")
    return payload


def extract_path_id(path: str, prefix: str) -> str:
    value = unquote(path.removeprefix(prefix)).strip("/")
    if not value or "/" in value:
        raise ValueError("Invalid resource identifier.")
    return value


def extract_match_ids(path: str) -> tuple[str, str]:
    parts = path.removeprefix("/matches/").strip("/").split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError("Invalid match identifier.")
    return unquote(parts[0]), unquote(parts[1])


def get_query_param(event: dict[str, Any], key: str) -> str | None:
    params = event.get("queryStringParameters") or {}
    return optional_string(params.get(key))


def optional_string(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def get_request_user_id(event: dict[str, Any]) -> str:
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    user_id = str(claims.get("sub") or "").strip()
    if not user_id:
        raise PermissionError("Authenticated user context is required.")
    return user_id


def query_owner_items(
    table: Any, index_name: str, user_id: str, scan_forward: bool = True
) -> list[dict[str, Any]]:
    items = []
    response = table.query(
        IndexName=index_name,
        KeyConditionExpression=Key("owner_id").eq(user_id),
        ScanIndexForward=scan_forward,
    )
    items.extend(response.get("Items", []))

    while "LastEvaluatedKey" in response:
        response = table.query(
            IndexName=index_name,
            KeyConditionExpression=Key("owner_id").eq(user_id),
            ScanIndexForward=scan_forward,
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))

    return items


def query_owner_event_items(
    table: Any,
    index_name: str,
    user_id: str,
    event_id: str,
    scan_forward: bool = True,
) -> list[dict[str, Any]]:
    return [
        item
        for item in query_owner_items(table, index_name, user_id, scan_forward)
        if item_event_id(item, user_id) == event_id
    ]


def query_all_items(table: Any, **query_kwargs: Any) -> list[dict[str, Any]]:
    items = []
    response = table.query(**query_kwargs)
    items.extend(response.get("Items", []))

    while "LastEvaluatedKey" in response:
        response = table.query(
            **query_kwargs,
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))

    return items


def get_owned_item(
    table: Any, key: dict[str, str], user_id: str, label: str
) -> dict[str, Any]:
    item = table.get_item(Key=key).get("Item")
    if not item or item.get("owner_id") != user_id:
        raise LookupError(f"{label} was not found.")
    return item


def delete_s3_object(key: str) -> None:
    s3.delete_object(Bucket=BUCKET_NAME, Key=key)


def decrement_person_photo_count(person_id: str) -> None:
    people_table.update_item(
        Key={"id": person_id},
        UpdateExpression="SET updated_at = :now ADD photo_count :minus_one",
        ExpressionAttributeValues={":minus_one": -1, ":now": iso_now()},
    )


def decrement_photo_match_count(photo_id: str) -> None:
    photos_table.update_item(
        Key={"id": photo_id},
        UpdateExpression="ADD match_count :minus_one",
        ExpressionAttributeValues={":minus_one": -1},
    )


def increment_person_photo_count(person_id: str) -> None:
    people_table.update_item(
        Key={"id": person_id},
        UpdateExpression="SET updated_at = :now ADD photo_count :one",
        ExpressionAttributeValues={":one": 1, ":now": iso_now()},
    )


def increment_photo_match_count(photo_id: str) -> None:
    photos_table.update_item(
        Key={"id": photo_id},
        UpdateExpression="ADD match_count :one",
        ExpressionAttributeValues={":one": 1},
    )


def validate_upload_session(
    upload_id: str,
    key: str,
    mode: str,
    file_item: dict[str, Any],
    user_id: str,
    event_id: str,
) -> dict[str, Any]:
    response = uploads_table.get_item(Key={"id": upload_id})
    session = response.get("Item")
    if not session:
        raise ValueError("Upload session was not found.")
    if session.get("owner_id") != user_id:
        raise ValueError("Upload session does not belong to the authenticated user.")
    if str(session.get("event_id") or default_event_id(user_id)) != event_id:
        raise ValueError("Upload session does not belong to the selected event.")
    if session.get("mode") != mode or session.get("key") != key:
        raise ValueError("Upload session does not match the requested file.")
    if session.get("status") != "issued":
        raise ValueError("Upload session has already been used.")
    if int(session.get("expires_at") or 0) < int(time.time()):
        raise ValueError("Upload session has expired.")
    if session.get("name") != file_item["name"]:
        raise ValueError("Upload session filename does not match.")
    if int(session.get("size") or 0) != int(file_item["size"]):
        raise ValueError("Upload session file size does not match.")
    return session


def verify_s3_upload(session: dict[str, Any]) -> dict[str, Any]:
    try:
        head = s3.head_object(Bucket=BUCKET_NAME, Key=session["key"])
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code in {"403", "404", "NoSuchKey", "NotFound"}:
            raise ValueError("Uploaded object was not found in S3.") from error
        raise

    size = int(head.get("ContentLength") or 0)
    expected_size = int(session.get("size") or 0)
    content_type = str(head.get("ContentType") or "")
    expected_content_type = str(session.get("content_type") or "")
    metadata = head.get("Metadata") or {}

    if size != expected_size:
        raise ValueError("Uploaded object size does not match the issued session.")
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError("Uploaded object exceeds the configured size limit.")
    if content_type.lower() != expected_content_type.lower():
        raise ValueError("Uploaded object content type does not match the issued session.")
    if metadata.get("upload-id") != session["id"]:
        raise ValueError("Uploaded object metadata does not match the issued session.")

    return {"size": size, "content_type": content_type}


def claim_upload_session(
    file_item: dict[str, Any], mode: str, user_id: str, event_id: str
) -> None:
    try:
        uploads_table.update_item(
            Key={"id": file_item["uploadId"]},
            UpdateExpression="SET #status = :processing, processing_at = :now",
            ConditionExpression=(
                "#status = :issued AND owner_id = :owner_id AND #mode = :mode "
                "AND event_id = :event_id AND #object_key = :object_key "
                "AND expires_at >= :now_epoch"
            ),
            ExpressionAttributeNames={
                "#status": "status",
                "#mode": "mode",
                "#object_key": "key",
            },
            ExpressionAttributeValues={
                ":issued": "issued",
                ":processing": "processing",
                ":owner_id": user_id,
                ":event_id": event_id,
                ":mode": mode,
                ":object_key": file_item["key"],
                ":now": iso_now(),
                ":now_epoch": int(time.time()),
            },
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            raise ValueError("Upload session is not available for processing.") from error
        raise


def mark_upload_processed(upload_id: str) -> None:
    uploads_table.update_item(
        Key={"id": upload_id},
        UpdateExpression="SET #status = :processed, processed_at = :now",
        ConditionExpression="#status = :processing",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":processed": "processed",
            ":processing": "processing",
            ":now": iso_now(),
        },
    )


def mark_upload_failed(upload_id: str, reason: str) -> None:
    try:
        uploads_table.update_item(
            Key={"id": upload_id},
            UpdateExpression=(
                "SET #status = :failed, failed_at = :now, failure_reason = :reason"
            ),
            ConditionExpression="#status = :processing",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":failed": "failed",
                ":processing": "processing",
                ":now": iso_now(),
                ":reason": reason[:250],
            },
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code != "ConditionalCheckFailedException":
            log_event("warning", "mark_upload_failed_error", error=error.response)


def signed_get_url(key: str) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET_NAME, "Key": key},
        ExpiresIn=URL_EXPIRES_SECONDS,
    )


def response(status_code: int, payload: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": cors_headers(event),
        "body": "" if status_code == 204 else json.dumps(payload, default=decimal_default),
    }


def cors_headers(event: dict[str, Any]) -> dict[str, str]:
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin") or ""
    allow_origin = "*"

    if "*" not in ALLOWED_ORIGINS and origin in ALLOWED_ORIGINS:
        allow_origin = origin
    elif "*" not in ALLOWED_ORIGINS and ALLOWED_ORIGINS:
        allow_origin = ALLOWED_ORIGINS[0]

    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Headers": "content-type,authorization",
        "Access-Control-Allow-Methods": "DELETE,GET,PATCH,POST,OPTIONS",
        "Content-Type": "application/json",
    }


def name_from_filename(filename: str) -> str:
    value = re.sub(r"\.[^.]+$", "", filename)
    value = re.sub(r"[_-]+", " ", value)
    value = re.sub(r"\s+\d+$", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return " ".join(part.capitalize() for part in value.split(" ")) or "Unknown"


def initials_from_name(name: str) -> str:
    parts = [part for part in name.split(" ") if part]
    if not parts:
        return "?"
    first = parts[0][0]
    last = parts[-1][0] if len(parts) > 1 else ""
    return f"{first}{last}".upper()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or str(uuid.uuid4())


def safe_filename(filename: str) -> str:
    basename = filename.split("/")[-1].split("\\")[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", basename).strip("-")
    return cleaned or f"upload-{uuid.uuid4()}.jpg"


def s3_owner_prefix(user_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", user_id).strip("-") or "unknown"


def log_event(level: str, message: str, **fields: Any) -> None:
    print(
        json.dumps(
            {
                "level": level,
                "message": message,
                **fields,
            },
            default=str,
        )
    )


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def decimal_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError
