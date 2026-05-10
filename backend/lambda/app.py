import base64
import json
import os
import re
import time
import uuid
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


BUCKET_NAME = os.environ["BUCKET_NAME"]
PEOPLE_TABLE = os.environ["PEOPLE_TABLE"]
PHOTOS_TABLE = os.environ["PHOTOS_TABLE"]
MATCHES_TABLE = os.environ["MATCHES_TABLE"]
UPLOADS_TABLE = os.environ["UPLOADS_TABLE"]
COLLECTION_ID = os.environ["COLLECTION_ID"]
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

            if method == "GET" and path == "/library":
                result = response(200, get_library(user_id), event)
            elif method == "POST" and path == "/uploads/presign":
                result = response(200, presign_uploads(read_json(event), user_id), event)
            elif method == "POST" and path == "/uploads/process":
                result = response(200, process_uploads(read_json(event), user_id), event)
            else:
                result = response(404, {"message": "Route not found"}, event)
    except PermissionError as error:
        result = response(401, {"message": str(error)}, event)
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


def presign_uploads(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
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
            f"users/{owner_prefix}/{mode}/{now_prefix}/"
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
    mode = validate_mode(payload.get("mode"))
    files = validate_processed_files(payload.get("files"), mode, user_id)

    if mode == "references":
        return process_reference_files(files, user_id)

    return process_photo_files(files, user_id)


def process_reference_files(files: list[dict[str, Any]], user_id: str) -> dict[str, Any]:
    people = []
    owner_prefix = s3_owner_prefix(user_id)

    for file_item in files:
        claim_upload_session(file_item, mode="references", user_id=user_id)
        try:
            person_name = name_from_filename(file_item["name"])
            person_id = f"person-{owner_prefix}-{slugify(person_name)}"

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
                    "SET owner_id = :owner_id, #name = :name, initials = :initials, "
                    "updated_at = :now, "
                    "reference_keys = list_append(if_not_exists(reference_keys, :empty), :keys), "
                    "face_ids = list_append(if_not_exists(face_ids, :empty), :face_ids) "
                    "ADD reference_count :one"
                ),
                ExpressionAttributeNames={"#name": "name"},
                ExpressionAttributeValues={
                    ":owner_id": user_id,
                    ":name": person_name,
                    ":initials": initials_from_name(person_name),
                    ":now": now,
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


def process_photo_files(files: list[dict[str, Any]], user_id: str) -> dict[str, Any]:
    people = query_owner_items(people_table, PEOPLE_OWNER_INDEX, user_id)
    people = sorted(people, key=lambda item: item.get("name", ""))[:MAX_COMPARE_PEOPLE]
    photos = []
    owner_prefix = s3_owner_prefix(user_id)

    for file_item in files:
        claim_upload_session(file_item, mode="photos", user_id=user_id)
        try:
            photo_id = f"photo-{owner_prefix}-{uuid.uuid4()}"
            now = iso_now()
            matches = find_matches(file_item["key"], people)

            photos_table.put_item(
                Item={
                    "id": photo_id,
                    "owner_id": user_id,
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
            status = "matched" if best_similarity >= MATCHED_THRESHOLD else "review"
            matches.append(
                {
                    "personId": person["id"],
                    "personName": person["name"],
                    "confidence": round(best_similarity, 1),
                    "status": status,
                }
            )

    return sorted(matches, key=lambda item: item["confidence"], reverse=True)


def get_library(user_id: str) -> dict[str, Any]:
    people = [
        normalize_person(item)
        for item in query_owner_items(people_table, PEOPLE_OWNER_INDEX, user_id)
    ]
    raw_photos = query_owner_items(
        photos_table, PHOTOS_OWNER_INDEX, user_id, scan_forward=False
    )
    raw_matches = query_owner_items(matches_table, MATCHES_OWNER_INDEX, user_id)
    matches_by_photo: dict[str, list[dict[str, Any]]] = {}

    for item in raw_matches:
        photo_id = item["photo_id"]
        matches_by_photo.setdefault(photo_id, []).append(
            {
                "personId": item["person_id"],
                "personName": item["person_name"],
                "confidence": float(item["confidence"]),
                "status": item["status"],
            }
        )

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
        "people": sorted(people, key=lambda item: item["name"]),
        "photos": sorted(photos, key=lambda item: item["uploadedAt"], reverse=True),
    }


def normalize_person(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "name": item["name"],
        "initials": item.get("initials") or initials_from_name(item["name"]),
        "referenceCount": int(item.get("reference_count") or 0),
        "photoCount": int(item.get("photo_count") or 0),
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


def validate_processed_files(files: Any, mode: str, user_id: str) -> list[dict[str, Any]]:
    cleaned = validate_files(files)
    expected_prefix = f"users/{s3_owner_prefix(user_id)}/{mode}/"
    for index, file_item in enumerate(files):
        upload_id = str(file_item.get("uploadId") or "").strip()
        key = str(file_item.get("key") or "").strip()
        if not upload_id:
            raise ValueError("Each processed file needs an upload session ID.")
        if not key:
            raise ValueError("Each processed file needs an S3 key.")
        if not key.startswith(expected_prefix):
            raise ValueError("Uploaded file key is outside the authenticated user scope.")
        session = validate_upload_session(upload_id, key, mode, cleaned[index], user_id)
        verified = verify_s3_upload(session)
        cleaned[index]["uploadId"] = upload_id
        cleaned[index]["key"] = key
        cleaned[index]["size"] = verified["size"]
        cleaned[index]["type"] = verified["content_type"]
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


def validate_upload_session(
    upload_id: str,
    key: str,
    mode: str,
    file_item: dict[str, Any],
    user_id: str,
) -> dict[str, Any]:
    response = uploads_table.get_item(Key={"id": upload_id})
    session = response.get("Item")
    if not session:
        raise ValueError("Upload session was not found.")
    if session.get("owner_id") != user_id:
        raise ValueError("Upload session does not belong to the authenticated user.")
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


def claim_upload_session(file_item: dict[str, Any], mode: str, user_id: str) -> None:
    try:
        uploads_table.update_item(
            Key={"id": file_item["uploadId"]},
            UpdateExpression="SET #status = :processing, processing_at = :now",
            ConditionExpression=(
                "#status = :issued AND owner_id = :owner_id AND #mode = :mode "
                "AND #object_key = :object_key AND expires_at >= :now_epoch"
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
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
