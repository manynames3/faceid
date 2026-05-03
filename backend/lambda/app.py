import base64
import json
import os
import re
import time
import uuid
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError


BUCKET_NAME = os.environ["BUCKET_NAME"]
PEOPLE_TABLE = os.environ["PEOPLE_TABLE"]
PHOTOS_TABLE = os.environ["PHOTOS_TABLE"]
MATCHES_TABLE = os.environ["MATCHES_TABLE"]
COLLECTION_ID = os.environ["COLLECTION_ID"]
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
URL_EXPIRES_SECONDS = int(os.environ.get("URL_EXPIRES_SECONDS", "3600"))

s3 = boto3.client("s3")
rekognition = boto3.client("rekognition")
dynamodb = boto3.resource("dynamodb")
people_table = dynamodb.Table(PEOPLE_TABLE)
photos_table = dynamodb.Table(PHOTOS_TABLE)
matches_table = dynamodb.Table(MATCHES_TABLE)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")

    if method == "OPTIONS":
        return response(204, {}, event)

    try:
        if method == "GET" and path == "/library":
            return response(200, get_library(), event)
        if method == "POST" and path == "/uploads/presign":
            return response(200, presign_uploads(read_json(event)), event)
        if method == "POST" and path == "/uploads/process":
            return response(200, process_uploads(read_json(event)), event)
        return response(404, {"message": "Route not found"}, event)
    except ValueError as error:
        return response(400, {"message": str(error)}, event)
    except ClientError as error:
        print(json.dumps(error.response, default=str))
        return response(502, {"message": "AWS service call failed"}, event)
    except Exception as error:
        print(repr(error))
        return response(500, {"message": "Unexpected server error"}, event)


def presign_uploads(payload: dict[str, Any]) -> dict[str, Any]:
    mode = validate_mode(payload.get("mode"))
    files = validate_files(payload.get("files"))
    upload_items = []
    now_prefix = time.strftime("%Y/%m/%d")

    for file_item in files:
        content_type = clean_content_type(file_item.get("type"))
        key = f"{mode}/{now_prefix}/{uuid.uuid4()}-{safe_filename(file_item['name'])}"
        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=900,
            HttpMethod="PUT",
        )
        upload_items.append(
            {
                "name": file_item["name"],
                "key": key,
                "url": url,
                "headers": {"Content-Type": content_type},
            }
        )

    return {"uploads": upload_items}


def process_uploads(payload: dict[str, Any]) -> dict[str, Any]:
    mode = validate_mode(payload.get("mode"))
    files = validate_processed_files(payload.get("files"))

    if mode == "references":
        return process_reference_files(files)

    return process_photo_files(files)


def process_reference_files(files: list[dict[str, Any]]) -> dict[str, Any]:
    people = []

    for file_item in files:
        person_name = name_from_filename(file_item["name"])
        person_id = f"person-{slugify(person_name)}"

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
            continue

        now = iso_now()
        updated = people_table.update_item(
            Key={"id": person_id},
            UpdateExpression=(
                "SET #name = :name, initials = :initials, updated_at = :now, "
                "reference_keys = list_append(if_not_exists(reference_keys, :empty), :keys), "
                "face_ids = list_append(if_not_exists(face_ids, :empty), :face_ids) "
                "ADD reference_count :one"
            ),
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={
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

    return {"people": people, "photos": []}


def process_photo_files(files: list[dict[str, Any]]) -> dict[str, Any]:
    people = scan_all(people_table)
    people = sorted(people, key=lambda item: item.get("name", ""))[:MAX_COMPARE_PEOPLE]
    photos = []

    for file_item in files:
        photo_id = f"photo-{uuid.uuid4()}"
        now = iso_now()
        matches = find_matches(file_item["key"], people)

        photos_table.put_item(
            Item={
                "id": photo_id,
                "name": file_item["name"],
                "key": file_item["key"],
                "size": int(file_item.get("size") or 0),
                "uploaded_at": now,
                "match_count": len(matches),
            }
        )

        for match in matches:
            matches_table.put_item(
                Item={
                    "photo_id": photo_id,
                    "person_id": match["personId"],
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
                "size": int(file_item.get("size") or 0),
                "uploadedAt": now,
                "previewUrl": signed_get_url(file_item["key"]),
                "matches": matches,
            }
        )

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


def get_library() -> dict[str, Any]:
    people = [normalize_person(item) for item in scan_all(people_table)]
    raw_photos = scan_all(photos_table)
    raw_matches = scan_all(matches_table)
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


def validate_processed_files(files: Any) -> list[dict[str, Any]]:
    cleaned = validate_files(files)
    for index, file_item in enumerate(files):
        key = str(file_item.get("key") or "").strip()
        if not key:
            raise ValueError("Each processed file needs an S3 key.")
        cleaned[index]["key"] = key
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


def scan_all(table: Any) -> list[dict[str, Any]]:
    items = []
    response = table.scan()
    items.extend(response.get("Items", []))

    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        items.extend(response.get("Items", []))

    return items


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


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def decimal_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError
