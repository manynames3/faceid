import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
import uuid
from decimal import Decimal
from typing import Any
from urllib.parse import quote, unquote

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError


BUCKET_NAME = os.environ["BUCKET_NAME"]
EVENTS_TABLE = os.environ["EVENTS_TABLE"]
PEOPLE_TABLE = os.environ["PEOPLE_TABLE"]
PHOTOS_TABLE = os.environ["PHOTOS_TABLE"]
MATCHES_TABLE = os.environ["MATCHES_TABLE"]
UPLOADS_TABLE = os.environ["UPLOADS_TABLE"]
COLLECTION_ID = os.environ["COLLECTION_ID"]
INTAKE_TOKEN_SECRET = os.environ.get("INTAKE_TOKEN_SECRET", "")
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
transaction_client = boto3.client("dynamodb")
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
        elif method == "GET" and path == "/guest-intake":
            result = response(200, get_guest_intake(event.get("queryStringParameters") or {}), event)
        elif method == "POST" and path == "/guest-intake/presign":
            result = response(200, presign_guest_references(read_json(event)), event)
        elif method == "POST" and path == "/guest-intake/process":
            result = response(200, process_guest_references(read_json(event)), event)
        elif method == "POST" and path == "/guest-intake/status":
            result = response(200, get_guest_submission(read_json(event)), event)
        elif method == "GET" and path == "/guest-gallery":
            result = response(200, get_guest_gallery(event.get("queryStringParameters") or {}), event)
        elif method == "GET" and path.startswith("/guest-gallery/photos/") and path.endswith("/download"):
            photo_id = extract_path_id(path.removesuffix("/download"), "/guest-gallery/photos/")
            result = response(200, get_gallery_download(photo_id, event.get("queryStringParameters") or {}), event)
        else:
            user_id = get_request_user_id(event)

            if method == "GET" and path == "/events":
                result = response(200, {"events": list_events(user_id)}, event)
            elif method == "POST" and path == "/events":
                result = response(201, {"event": create_event(read_json(event), user_id)}, event)
            elif method == "PATCH" and path.startswith("/events/"):
                result = response(200, {"event": update_event(extract_path_id(path, "/events/"), read_json(event), user_id)}, event)
            elif method == "GET" and path.startswith("/events/") and path.endswith("/intake-link"):
                event_id = extract_path_id(path.removesuffix("/intake-link"), "/events/")
                result = response(200, get_event_intake_link(event_id, user_id, event), event)
            elif method == "GET" and path == "/library":
                event_id = get_query_param(event, "eventId")
                result = response(200, get_library(user_id, event_id), event)
            elif method == "POST" and path.startswith("/people/") and path.endswith("/gallery-link"):
                person_id = extract_path_id(path.removesuffix("/gallery-link"), "/people/")
                result = response(200, create_gallery_link(person_id, user_id, event, read_json(event)), event)
            elif method == "DELETE" and path.startswith("/people/") and path.endswith("/gallery-link"):
                person_id = extract_path_id(path.removesuffix("/gallery-link"), "/people/")
                result = response(200, disable_gallery_link(person_id, user_id), event)
            elif method == "POST" and path.startswith("/photos/") and path.endswith("/guests"):
                photo_id = extract_path_id(path.removesuffix("/guests"), "/photos/")
                result = response(200, {"match": assign_photo_guest(photo_id, read_json(event), user_id)}, event)
            elif method == "POST" and path.startswith("/photos/") and path.endswith("/rematch"):
                photo_id = extract_path_id(path.removesuffix("/rematch"), "/photos/")
                result = response(200, rematch_photo_guest(photo_id, read_json(event), user_id), event)
            elif method == "POST" and path == "/uploads/presign":
                result = response(200, presign_uploads(read_json(event), user_id), event)
            elif method == "POST" and path == "/uploads/process":
                result = response(200, process_uploads(read_json(event), user_id), event)
            elif method == "GET" and path.startswith("/photos/") and path.endswith("/download"):
                photo = get_owned_item(photos_table, {"id": extract_path_id(path.removesuffix("/download"), "/photos/")}, user_id, "Photo")
                result = response(200, {"url": signed_download_url(photo["key"], photo["name"]), "filename": photo["name"]}, event)
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
    except BlockingIOError as error:
        result = response(409, {"message": str(error)}, event)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            result = response(409, {"message": "This item changed while saving. Refresh and check before trying again."}, event)
        else:
            log_event("error", "aws_service_call_failed", error=error.response)
            result = response(502, {"message": "The service couldn't finish this request. Refresh and check before trying again."}, event)
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


def update_event(event_id: str, payload: dict[str, Any], user_id: str) -> dict[str, Any]:
    event = get_owned_event(event_id, user_id)
    name = validate_event_name(payload.get("name", event["name"]))
    host = str(payload.get("hostName", event.get("host_name", ""))).strip()
    contact = str(payload.get("contactEmail", event.get("contact_email", ""))).strip()
    signup_open = payload.get("signupOpen", event.get("signup_open", True))
    if len(host) > 80 or re.search(r"[\x00-\x1f\x7f]", host):
        raise ValueError("Host or studio name must be at most 80 characters without control characters.")
    if contact and (len(contact) > 254 or not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", contact)):
        raise ValueError("Enter a valid contact email address.")
    if not isinstance(signup_open, bool):
        raise ValueError("signupOpen must be true or false.")
    version = int(event.get("intake_version", 0))
    if signup_open and event.get("signup_open", True) is False:
        version += 1  # Reopening never reactivates a previously shared link.
    values = {":name": name, ":host_name": host, ":contact_email": contact,
              ":signup_open": signup_open, ":intake_version": version,
              ":updated_at": iso_now(), ":owner_id": user_id}
    conditions = ["owner_id = :owner_id"]
    # A stale settings request must never restore an old invitation version or reopen signup.
    for field in ("intake_version", "signup_open"):
        if field in event:
            values[f":previous_{field}"] = event[field]
            conditions.append(f"{field} = :previous_{field}")
        else:
            conditions.append(f"attribute_not_exists({field})")
    try:
        result = events_table.update_item(
            Key={"id": event_id},
            UpdateExpression="SET #name = :name, host_name = :host_name, contact_email = :contact_email, signup_open = :signup_open, intake_version = :intake_version, updated_at = :updated_at",
            ConditionExpression=" AND ".join(conditions),
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise ValueError("Event details changed in another tab. Refresh the event, then try again.") from error
        raise
    return normalize_event(result["Attributes"])


def ensure_default_event(user_id: str) -> dict[str, Any]:
    event_id = default_event_id(user_id)
    event = events_table.get_item(Key={"id": event_id}, ConsistentRead=True).get("Item")
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

    event = events_table.get_item(Key={"id": event_id}, ConsistentRead=True).get("Item")
    if not event or event.get("owner_id") != user_id:
        raise LookupError("Event was not found.")
    return event


def sign_intake_token(event_id: str, version: int = 0) -> str:
    if not INTAKE_TOKEN_SECRET:
        raise ValueError("Guest intake links are not configured.")
    message = event_id if version == 0 else f"{event_id}:intake:{version}"
    return hmac.new(INTAKE_TOKEN_SECRET.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def get_public_event(event_id: str, token: str, require_open: bool = True) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        raise LookupError("Guest intake link was not found.")
    event = events_table.get_item(Key={"id": event_id}, ConsistentRead=True).get("Item")
    if not event or not hmac.compare_digest(token, sign_intake_token(event_id, int(event.get("intake_version", 0)))):
        raise LookupError("Guest intake link was not found.")
    if require_open and event.get("signup_open", True) is False:
        raise ValueError("Guest signup has closed. Contact your host for help.")
    return event


def get_event_intake_link(event_id: str, user_id: str, request_event: dict[str, Any]) -> dict[str, Any]:
    event = get_owned_event(event_id, user_id)
    if event.get("signup_open", True) is False:
        raise ValueError("Guest signup is closed. Reopen it in Event details to create a new link.")
    token = sign_intake_token(event["id"], int(event.get("intake_version", 0)))
    origin = (request_event.get("headers") or {}).get("origin") or "http://localhost:5173"
    if origin not in ALLOWED_ORIGINS:
        origin = next((value for value in ALLOWED_ORIGINS if value.startswith("https://")), "http://localhost:5173")
    return {"eventId": event["id"], "eventName": event["name"], "token": token,
            "intakeUrl": f"{origin.rstrip('/')}/guest?eventId={quote(event['id'])}&token={quote(token)}"}


def get_guest_intake(params: dict[str, Any]) -> dict[str, Any]:
    event = get_public_event(require_string(params.get("eventId"), "eventId"), require_string(params.get("token"), "token"), require_open=False)
    return {"eventId": event["id"], "eventName": event["name"],
            "hostName": event.get("host_name", ""), "contactEmail": event.get("contact_email", ""),
            "signupOpen": event.get("signup_open", True)}


def get_guest_submission(payload: dict[str, Any]) -> dict[str, Any]:
    event = get_public_event(require_string(payload.get("eventId"), "eventId"), require_string(payload.get("token"), "token"), require_open=False)
    ids = payload.get("uploadIds")
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_REFS_PER_PERSON or any(not isinstance(value, str) or not value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("A valid submission receipt is required.")
    sessions = [uploads_table.get_item(Key={"id": value}, ConsistentRead=True).get("Item") for value in ids]
    if any(not item or item.get("event_id") != event["id"] or item.get("owner_id") != event["owner_id"]
           or item.get("intake_source") != "guest_submitted" or item.get("mode") != "references" for item in sessions):
        raise LookupError("Submission was not found.")
    person_ids = {item.get("person_id") for item in sessions}
    if len(person_ids) != 1 or None in person_ids:
        raise LookupError("Submission was not found.")
    person = people_table.get_item(Key={"id": next(iter(person_ids))}, ConsistentRead=True).get("Item")
    saved = 0
    if person and person.get("owner_id") == event["owner_id"] and item_event_id(person, event["owner_id"]) == event["id"]:
        saved = sum(item["key"] in person.get("reference_keys", []) for item in sessions)
    finished = all(item.get("status") in {"processed", "failed"} for item in sessions)
    status = "saved" if saved == len(sessions) else "partial" if finished and saved else "not_saved" if finished else "pending"
    return {"status": status, "referenceCount": saved,
            "name": person["name"] if saved else ""}


def presign_guest_references(payload: dict[str, Any]) -> dict[str, Any]:
    event = get_public_event(require_string(payload.get("eventId"), "eventId"), require_string(payload.get("token"), "token"))
    guest_name = validate_guest_name(payload.get("guestName"))
    result = presign_uploads({"eventId": event["id"], "mode": "references", "guestName": guest_name,
                             "files": payload.get("files")}, event["owner_id"])
    for upload in result["uploads"]:
        session = uploads_table.get_item(Key={"id": upload["uploadId"]})["Item"]
        uploads_table.put_item(Item={**session, "intake_source": "guest_submitted"})
    return result


def process_guest_references(payload: dict[str, Any]) -> dict[str, Any]:
    event = get_public_event(require_string(payload.get("eventId"), "eventId"), require_string(payload.get("token"), "token"))
    guest_name = validate_guest_name(payload.get("guestName"))
    consent = validate_reference_consent(payload.get("consent"), expected_source="guest_submitted")
    files = validate_processed_files(payload.get("files"), "references", event["owner_id"], event["id"])
    legacy_person_id = f"person-{uuid.uuid4()}"
    for file_item in files:
        session = uploads_table.get_item(Key={"id": file_item["uploadId"]})["Item"]
        # Sessions issued by the old guest portal stored a name but no person ID.
        legacy_guest = session.get("guest_name") is not None and not session.get("person_id")
        if session.get("guest_name") != guest_name or (
            session.get("intake_source") != "guest_submitted" and not legacy_guest
        ):
            raise ValueError("Upload session does not match this guest signup.")
        file_item["personName"] = guest_name
        file_item["personId"] = session.get("person_id") or legacy_person_id
    return process_reference_files(files, event["owner_id"], event["id"], consent)


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
        "hostName": item.get("host_name", ""),
        "contactEmail": item.get("contact_email", ""),
        "signupOpen": item.get("signup_open", True),
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
    guest_name = optional_string(payload.get("guestName"))
    person_id = optional_string(payload.get("personId"))
    existing_person = None
    if guest_name or person_id:
        if mode != "references":
            raise ValueError("Guest details are only supported for reference photos.")
        if person_id:
            existing_person = get_owned_item(people_table, {"id": person_id}, user_id, "Guest")
            if item_event_id(existing_person, user_id) != event_id:
                raise ValueError("Guest does not belong to the selected event.")
            if guest_name and validate_guest_name(guest_name) != existing_person["name"]:
                raise ValueError("Guest name does not match the selected guest.")
            guest_name = existing_person["name"]
        else:
            guest_name = validate_guest_name(guest_name)
            person_id = f"person-{uuid.uuid4()}"
        if int((existing_person or {}).get("reference_count") or 0) + len(files) > MAX_REFS_PER_PERSON:
            raise ValueError(f"Use at most {MAX_REFS_PER_PERSON} reference photos per guest.")
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
                **({"guest_name": guest_name, "person_id": person_id,
                    "existing_person": bool(existing_person)} if guest_name else {}),
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
    consent = validate_reference_consent(payload.get("consent")) if mode == "references" else None
    files = validate_processed_files(payload.get("files"), mode, user_id, event_id)

    if mode == "references":
        guest_name = optional_string(payload.get("guestName"))
        person_id = optional_string(payload.get("personId"))
        if guest_name and any(item.get("personName") != validate_guest_name(guest_name) for item in files):
            raise ValueError("Guest name does not match the issued upload session.")
        if person_id and any(item.get("personId") != person_id for item in files):
            raise ValueError("Guest does not match the issued upload session.")
        return process_reference_files(files, user_id, event_id, consent)

    return process_photo_files(files, user_id, event_id)


def validate_reference_consent(consent: Any, expected_source: str = "owner_attested") -> dict[str, str]:
    if not isinstance(consent, dict) or consent.get("confirmed") is not True:
        raise ValueError("Reference uploads require confirmed guest consent.")

    source = str(consent.get("source") or "owner_attested").strip()
    if source != expected_source:
        raise ValueError("Owner reference uploads require owner-attested permission." if expected_source == "owner_attested"
                         else "Guest reference uploads require guest-submitted permission.")

    return {
        "consentStatus": "captured",
        "consentSource": source,
        "consentCapturedAt": iso_now(),
    }


def validate_guest_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "").strip())
    if not name or len(name) > 80:
        raise ValueError("Guest name needs 1 to 80 characters.")
    if re.search(r"[\x00-\x1f\x7f]", name):
        raise ValueError("Guest name must not contain control characters.")
    return name


def process_reference_files(
    files: list[dict[str, Any]],
    user_id: str,
    event_id: str,
    consent: dict[str, str],
) -> dict[str, Any]:
    people = {}
    warnings = []
    owner_prefix = s3_owner_prefix(user_id)
    event_token = event_s3_token(event_id)

    for file_item in files:
        if file_item.get("existingPerson"):
            person = get_owned_item(people_table, {"id": file_item["personId"]}, user_id, "Guest")
            if item_event_id(person, user_id) != event_id:
                raise ValueError("Guest does not belong to the selected event.")
        claim_upload_session(
            file_item, mode="references", user_id=user_id, event_id=event_id
        )
        try:
            person_name = file_item.get("personName") or name_from_filename(file_item["name"])
            person_id = file_item.get("personId") or f"person-{owner_prefix}-{event_token}-{slugify(person_name)}"
            current = people_table.get_item(Key={"id": person_id}, ConsistentRead=True).get("Item")
            needs_existing = bool(current or file_item.get("existingPerson") or person_id in people)
            if needs_existing and (not current or current.get("owner_id") != user_id or item_event_id(current, user_id) != event_id or current.get("deletion_pending")):
                delete_s3_object(file_item["key"])
                raise LookupError("This guest was removed or removal is still finishing.")

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
                delete_s3_object(file_item["key"])
                warnings.append(f"No clear face found in {file_item['name']}. Choose a well-lit photo showing one face.")
                mark_upload_processed(file_item["uploadId"])
                continue

            now = iso_now()
            condition = "owner_id = :owner_id AND (attribute_not_exists(deletion_pending) OR deletion_pending = :not_pending)" if needs_existing else "attribute_not_exists(id)"
            extra_values = {":not_pending": False} if needs_existing else {}
            if file_item.get("personName"):
                condition += " AND (attribute_not_exists(reference_count) OR reference_count < :max_refs)"
                extra_values[":max_refs"] = MAX_REFS_PER_PERSON
            try:
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
                        **extra_values,
                    },
                    ReturnValues="ALL_NEW",
                    ConditionExpression=condition,
                )
            except ClientError as error:
                if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                    raise
                latest = people_table.get_item(Key={"id": person_id}, ConsistentRead=True).get("Item") or {}
                retained = set((current or {}).get("face_ids", [])) | set(latest.get("face_ids", []))
                disposable = [face_id for face_id in face_ids if face_id not in retained]
                if disposable:
                    rekognition.delete_faces(CollectionId=COLLECTION_ID, FaceIds=disposable)
                delete_s3_object(file_item["key"])
                raise ValueError("The guest changed or their reference limit was reached. Refresh before adding another photo.") from error
            people[person_id] = normalize_person(updated["Attributes"])
            mark_upload_processed(file_item["uploadId"])
        except Exception as error:
            mark_upload_failed(file_item["uploadId"], repr(error))
            raise

    return {"people": list(people.values()), "photos": [], "warnings": warnings}


def process_photo_files(
    files: list[dict[str, Any]], user_id: str, event_id: str
) -> dict[str, Any]:
    people = [person for person in query_owner_event_items(people_table, PEOPLE_OWNER_INDEX, user_id, event_id)
              if person.get("consent_status") == "captured" and not person.get("deletion_pending")]
    if not people:
        raise ValueError("Add a guest reference photo before uploading event photos.")
    if len(people) > MAX_COMPARE_PEOPLE:
        raise ValueError(f"This event exceeds the {MAX_COMPARE_PEOPLE}-guest matching limit. Use a smaller event before processing photos.")
    people = sorted(people, key=lambda item: item.get("name", ""))
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

            photo = {
                    "id": photo_id,
                    "owner_id": user_id,
                    "event_id": event_id,
                    "name": file_item["name"],
                    "key": file_item["key"],
                    "size": int(file_item["size"]),
                    "uploaded_at": now,
                    "match_count": 0,
                }
            photos_table.put_item(Item=photo)

            saved_matches = []
            people_by_id = {person["id"]: person for person in people}
            for match in matches:
                item = {
                        "photo_id": photo_id,
                        "person_id": match["personId"],
                        "owner_id": user_id,
                        "event_id": event_id,
                        "person_name": match["personName"],
                        "confidence": Decimal(str(round(match["confidence"], 2))),
                        "status": match["status"],
                        "uploaded_at": now,
                        **({"face_box": {key: Decimal(str(value)) for key, value in match["faceBox"].items()}} if match.get("faceBox") else {}),
                    }
                try:
                    write_match_atomically(photo, people_by_id[match["personId"]], item, None)
                except ValueError:
                    current = people_table.get_item(Key={"id": match["personId"]}, ConsistentRead=True).get("Item")
                    if not current or current.get("deletion_pending") or current.get("consent_status") != "captured":
                        continue
                    raise
                saved_matches.append(match)

            photos.append(
                {
                    "id": photo_id,
                    "name": file_item["name"],
                    "size": int(file_item["size"]),
                    "uploadedAt": now,
                    "previewUrl": signed_get_url(file_item["key"]),
                    "matches": saved_matches,
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
        best_box = None

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
                similarity = float(face_match.get("Similarity", 0))
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_box = normalize_face_box(face_match.get("Face", {}).get("BoundingBox"))

        if best_similarity >= REVIEW_THRESHOLD:
            status = "matched" if best_similarity >= MATCHED_THRESHOLD else "needs_review"
            matches.append(
                {
                    "personId": person["id"],
                    "personName": person["name"],
                    "confidence": round(best_similarity, 1),
                    "status": status,
                    **({"faceBox": best_box} if best_box else {}),
                }
            )

    return sorted(matches, key=lambda item: item["confidence"], reverse=True)


def normalize_face_box(box: Any) -> dict[str, float] | None:
    if not isinstance(box, dict):
        return None
    try:
        left, top, width, height = (float(box[key]) for key in ("Left", "Top", "Width", "Height"))
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (left, top, width, height)) or width <= 0 or height <= 0:
        return None
    right, bottom = min(1, left + width), min(1, top + height)
    left, top = max(0, left), max(0, top)
    if right <= left or bottom <= top:
        return None
    return {"left": left, "top": top, "width": right - left, "height": bottom - top}


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
                    key=lambda match: match.get("confidence", 0),
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


def get_photo_guest(photo_id: str, person_id: str, user_id: str, event_id: str) -> tuple[dict, dict]:
    photo = get_owned_item(photos_table, {"id": photo_id}, user_id, "Photo")
    person = get_owned_item(people_table, {"id": person_id}, user_id, "Guest")
    if item_event_id(photo, user_id) != event_id or item_event_id(person, user_id) != event_id:
        raise LookupError("Photo or guest was not found in this event.")
    if person.get("consent_status") != "captured" or person.get("deletion_pending"):
        raise ValueError("Record this guest's permission before adding or sharing their photos.")
    return photo, person


def write_match_atomically(photo: dict, person: dict, match: dict, previous: dict | None) -> None:
    serialize = TypeSerializer().serialize
    encode = lambda value: {key: serialize(item) for key, item in value.items()}
    owner = photo["owner_id"]
    delta = 1 if not previous or previous.get("status") == "rejected" else 0
    names = {}
    values = {}
    condition = "attribute_not_exists(photo_id)"
    if previous:
        names["#status"] = "status"
        values = {":owner": owner, ":previous": previous["status"]}
        condition = "owner_id = :owner AND #status = :previous"
        if previous.get("updated_at"):
            values[":revision"] = previous["updated_at"]
            condition += " AND updated_at = :revision"
        else:
            condition += " AND attribute_not_exists(updated_at)"
    put = {"TableName": MATCHES_TABLE, "Item": encode(match), "ConditionExpression": condition}
    if values:
        put["ExpressionAttributeValues"] = encode(values)
        put["ExpressionAttributeNames"] = names
    try:
        transaction_client.transact_write_items(TransactItems=[
            {"Put": put},
            {"Update": {
                "TableName": PHOTOS_TABLE, "Key": encode({"id": photo["id"]}),
                "UpdateExpression": "ADD match_count :delta",
                "ConditionExpression": "owner_id = :owner",
                "ExpressionAttributeValues": encode({":owner": owner, ":delta": delta}),
            }},
            {"Update": {
                "TableName": PEOPLE_TABLE, "Key": encode({"id": person["id"]}),
                "UpdateExpression": "SET updated_at = :now ADD photo_count :delta",
                "ConditionExpression": "owner_id = :owner AND consent_status = :consent AND (attribute_not_exists(deletion_pending) OR deletion_pending = :not_pending)",
                "ExpressionAttributeValues": encode({":owner": owner, ":consent": "captured", ":not_pending": False, ":delta": delta, ":now": iso_now()}),
            }},
        ])
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "TransactionCanceledException":
            raise ValueError("This photo or guest changed while saving. Refresh the event and check the result.") from error
        raise


def assign_photo_guest(photo_id: str, payload: dict, user_id: str) -> dict:
    event_id = require_string(payload.get("eventId"), "eventId")
    person_id = require_string(payload.get("personId"), "personId")
    photo, person = get_photo_guest(photo_id, person_id, user_id, event_id)
    previous = matches_table.get_item(Key={"photo_id": photo_id, "person_id": person_id}, ConsistentRead=True).get("Item")
    if previous and previous.get("owner_id") != user_id:
        raise LookupError("Match was not found.")
    if previous and previous.get("status") == "approved":
        return normalize_match(previous)
    now = iso_now()
    match = {"photo_id": photo_id, "person_id": person_id, "owner_id": user_id,
             "event_id": event_id, "person_name": person["name"], "status": "approved",
             "source": "manual", "uploaded_at": photo.get("uploaded_at", now),
             "reviewed_at": now, "updated_at": now}
    write_match_atomically(photo, person, match, previous)
    return normalize_match(match)


def rematch_photo_guest(photo_id: str, payload: dict, user_id: str) -> dict:
    event_id = require_string(payload.get("eventId"), "eventId")
    person_id = require_string(payload.get("personId"), "personId")
    request_id = require_string(payload.get("requestId"), "requestId")
    if not re.fullmatch(r"[a-zA-Z0-9-]{16,64}", request_id):
        raise ValueError("A valid matching request ID is required.")
    photo, person = get_photo_guest(photo_id, person_id, user_id, event_id)
    if not person.get("reference_keys"):
        raise ValueError("Add a reference photo for this guest first.")
    key = {"photo_id": photo_id, "person_id": person_id}
    previous = matches_table.get_item(Key=key, ConsistentRead=True).get("Item")
    if previous and previous.get("owner_id") != user_id:
        raise LookupError("Match was not found.")
    if previous and previous.get("status") in {"approved", "rejected"}:
        return {"match": normalize_match(previous), "outcome": "kept_decision"}
    operation_id = f"rematch-{s3_owner_prefix(user_id)}-{request_id}"
    operation = uploads_table.get_item(Key={"id": operation_id}, ConsistentRead=True).get("Item")
    if operation:
        if any(operation.get(field) != value for field, value in
               (("owner_id", user_id), ("event_id", event_id), ("photo_id", photo_id), ("person_id", person_id), ("mode", "rematch"))):
            raise ValueError("This matching request belongs to another photo or guest.")
        if operation.get("status") == "processed":
            current = matches_table.get_item(Key=key, ConsistentRead=True).get("Item")
            return {"match": normalize_match(current) if current else None, "outcome": operation["outcome"]}
        if operation.get("status") == "failed":
            raise ValueError("That matching attempt failed. Check the event and start a new search.")
        raise BlockingIOError("Matching is still unconfirmed. Check this request again before starting another search.")
    try:
        uploads_table.put_item(Item={
            "id": operation_id, "owner_id": user_id, "event_id": event_id,
            "photo_id": photo_id, "person_id": person_id, "mode": "rematch",
            "status": "processing", "expires_at": int(time.time()) + UPLOAD_SESSION_TTL_SECONDS,
        }, ConditionExpression="attribute_not_exists(id)")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise BlockingIOError("This matching request is already running. Check its result shortly.") from error
        raise
    try:
        candidates = find_matches(photo["key"], [person])
        outcome = "no_new_match"
        current = previous
        if candidates:
            candidate = candidates[0]
            now = iso_now()
            current = {"photo_id": photo_id, "person_id": person_id, "owner_id": user_id,
                       "event_id": event_id, "person_name": person["name"],
                       "confidence": Decimal(str(candidate["confidence"])), "status": candidate["status"],
                       "source": "face_match", "uploaded_at": photo.get("uploaded_at", now), "updated_at": now}
            if candidate.get("faceBox"):
                current["face_box"] = {key: Decimal(str(value)) for key, value in candidate["faceBox"].items()}
            write_match_atomically(photo, person, current, previous)
            outcome = "suggested"
        uploads_table.update_item(Key={"id": operation_id},
            UpdateExpression="SET #status = :processed, outcome = :outcome",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":processed": "processed", ":outcome": outcome})
        return {"match": normalize_match(current) if current else None, "outcome": outcome}
    except Exception:
        mark_upload_failed(operation_id, "Matching attempt did not finish.")
        raise


def gallery_token_hash(person_id: str, token: str) -> str:
    return hashlib.sha256(f"{person_id}:{token}".encode()).hexdigest()


def gallery_person(params: dict) -> dict:
    person_id = str(params.get("personId") or "")
    token = str(params.get("token") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise LookupError("This gallery is unavailable. Ask your host for a new link.")
    person = people_table.get_item(Key={"id": person_id}, ConsistentRead=True).get("Item")
    if not person or person.get("deletion_pending") or not person.get("gallery_enabled") or person.get("consent_status") != "captured" or int(person.get("gallery_expires_at", 0)) <= int(time.time()):
        raise LookupError("This gallery is unavailable. Ask your host for a new link.")
    if not hmac.compare_digest(gallery_token_hash(person_id, token), person.get("gallery_token_hash", "")):
        raise LookupError("This gallery is unavailable. Ask your host for a new link.")
    return person


def approved_gallery_photo(photo_id: str, person: dict) -> dict | None:
    match = matches_table.get_item(Key={"photo_id": photo_id, "person_id": person["id"]}, ConsistentRead=True).get("Item")
    owner = person["owner_id"]
    event_id = item_event_id(person, owner)
    if not match or match.get("owner_id") != owner or item_event_id(match, owner) != event_id or match.get("status") != "approved":
        return None
    photo = photos_table.get_item(Key={"id": photo_id}, ConsistentRead=True).get("Item")
    if not photo or photo.get("owner_id") != owner or item_event_id(photo, owner) != event_id:
        return None
    return photo


def create_gallery_link(person_id: str, user_id: str, request_event: dict, payload: dict | None = None) -> dict:
    person = get_owned_item(people_table, {"id": person_id}, user_id, "Guest")
    if person.get("consent_status") != "captured" or person.get("deletion_pending"):
        raise ValueError("Record this guest's permission before sharing photos.")
    event = get_owned_event(item_event_id(person, user_id), user_id)
    hint = (payload or {}).get("photoId")
    if hint is not None and (not isinstance(hint, str) or not hint or len(hint) > 256):
        raise ValueError("A valid approved photo ID is required.")
    first_photo = approved_gallery_photo(hint, person) if hint else None
    if not first_photo:
        candidates = query_all_items(matches_table, IndexName="person_id-photo_id-index", KeyConditionExpression=Key("person_id").eq(person_id))
        first_photo = next((photo for item in candidates if (photo := approved_gallery_photo(item["photo_id"], person))), None)
    if not first_photo:
        raise ValueError("Approve at least one photo for this guest before sharing.")
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + 7 * 24 * 3600
    people_table.update_item(Key={"id": person_id},
        UpdateExpression="SET gallery_token_hash = :hash, gallery_enabled = :enabled, gallery_expires_at = :expires, gallery_photo_hint = :photo_id",
        ConditionExpression="owner_id = :owner AND consent_status = :consent AND (attribute_not_exists(deletion_pending) OR deletion_pending = :not_pending)",
        ExpressionAttributeValues={":hash": gallery_token_hash(person_id, token), ":enabled": True,
                                   ":expires": expires, ":owner": user_id, ":consent": "captured", ":photo_id": first_photo["id"], ":not_pending": False})
    origin = (request_event.get("headers") or {}).get("origin")
    if origin not in ALLOWED_ORIGINS:
        origin = next((value for value in ALLOWED_ORIGINS if value.startswith("https://")), "http://localhost:5173")
    return {"galleryUrl": f"{origin.rstrip('/')}/gallery?personId={quote(person_id)}&token={quote(token)}",
            "expiresAt": expires, "person": normalize_person({**person, "gallery_enabled": True, "gallery_expires_at": expires})}


def disable_gallery_link(person_id: str, user_id: str) -> dict:
    person = get_owned_item(people_table, {"id": person_id}, user_id, "Guest")
    people_table.update_item(Key={"id": person_id}, UpdateExpression="SET gallery_enabled = :enabled",
                            ConditionExpression="owner_id = :owner",
                            ExpressionAttributeValues={":enabled": False, ":owner": user_id})
    return {"person": normalize_person({**person, "gallery_enabled": False})}


def get_guest_gallery(params: dict) -> dict:
    person = gallery_person(params)
    owner = person["owner_id"]
    event = get_owned_event(item_event_id(person, owner), owner)
    candidates = query_all_items(matches_table, IndexName="person_id-photo_id-index", KeyConditionExpression=Key("person_id").eq(person["id"]))
    ids = {item["photo_id"] for item in candidates}
    # The index can lag a just-approved first photo; the hint still gets full authorization checks.
    if person.get("gallery_photo_hint"):
        ids.add(person["gallery_photo_hint"])
    photos = []
    for photo_id in ids:
        photo = approved_gallery_photo(photo_id, person)
        if photo:
            photos.append({"id": photo["id"], "name": photo["name"], "previewUrl": signed_get_url(photo["key"], expires=300)})
    return {"eventName": event["name"], "guestName": person["name"],
            "hostName": event.get("host_name", ""), "contactEmail": event.get("contact_email", ""),
            "expiresAt": int(person["gallery_expires_at"]), "photos": sorted(photos, key=lambda photo: photo["name"])}


def get_gallery_download(photo_id: str, params: dict) -> dict:
    person = gallery_person(params)
    photo = approved_gallery_photo(photo_id, person)
    if not photo:
        raise LookupError("This photo is no longer available in your gallery.")
    return {"url": signed_download_url(photo["key"], photo["name"]), "filename": photo["name"]}


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
    # Stop access and new references before multi-service cleanup; keep the marker for safe retry.
    person = people_table.update_item(
        Key={"id": person_id},
        UpdateExpression="SET deletion_pending = :pending, gallery_enabled = :disabled",
        ConditionExpression="owner_id = :owner",
        ExpressionAttributeValues={":pending": True, ":disabled": False, ":owner": user_id},
        ReturnValues="ALL_NEW",
    )["Attributes"]
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

    updated = matches_table.update_item(
        Key={"photo_id": photo_id, "person_id": person_id},
        UpdateExpression=(
            "SET #status = :status, reviewed_at = :reviewed_at, updated_at = :updated_at"
        ),
        ConditionExpression="owner_id = :owner_id AND #status = :previous_status",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": status,
            ":reviewed_at": now,
            ":updated_at": now,
            ":owner_id": user_id,
            ":previous_status": match["status"],
        },
        ReturnValues="ALL_NEW",
    )

    if previous_status != "rejected" and status == "rejected":
        decrement_person_photo_count(person_id)
        decrement_photo_match_count(photo_id)
    elif previous_status == "rejected" and status != "rejected":
        increment_person_photo_count(person_id)
        increment_photo_match_count(photo_id)

    return normalize_match(updated["Attributes"])


def get_match_item(photo_id: str, person_id: str, user_id: str) -> dict[str, Any]:
    match = matches_table.get_item(
        Key={"photo_id": photo_id, "person_id": person_id}, ConsistentRead=True
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
        **({"confidence": float(item["confidence"])} if item.get("confidence") is not None else {}),
        "source": item.get("source", "face_match"),
        "status": normalize_status(item.get("status")),
        "reviewedAt": item.get("reviewed_at", ""),
        **({"faceBox": {key: float(value) for key, value in item["face_box"].items()}} if item.get("face_box") else {}),
    }


def count_review_matches(photos: list[dict[str, Any]]) -> int:
    return sum(
        1
        for photo in photos
        for match in photo["matches"]
        if match["status"] in {"matched", "needs_review"}
    )


def normalize_person(item: dict[str, Any]) -> dict[str, Any]:
    reference_keys = item.get("reference_keys") or []
    return {
        "id": item["id"],
        "name": item["name"],
        "initials": item.get("initials") or initials_from_name(item["name"]),
        "referenceCount": int(item.get("reference_count") or 0),
        "photoCount": int(item.get("photo_count") or 0),
        "consentStatus": item.get("consent_status", "unknown"),
        "consentSource": item.get("consent_source", ""),
        "consentCapturedAt": item.get("consent_captured_at", ""),
        "referencePreviewUrl": signed_get_url(reference_keys[0]) if reference_keys else "",
        "galleryEnabled": bool(item.get("gallery_enabled")) and int(item.get("gallery_expires_at", 0)) > int(time.time()),
        "galleryExpiresAt": int(item.get("gallery_expires_at", 0)),
        "deletionPending": bool(item.get("deletion_pending")),
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
        if size <= 0:
            raise ValueError(f"{name} is empty. Choose a JPEG or PNG photo.")
        if size > MAX_UPLOAD_MB * 1024 * 1024:
            raise ValueError(f"{name} exceeds the {MAX_UPLOAD_MB} MB upload limit.")
        if str(file_item.get("type") or "").lower() not in {"image/jpeg", "image/png"}:
            raise ValueError(f"{name} must be a JPEG or PNG photo.")
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
        if mode == "references" and session.get("guest_name"):
            cleaned[index]["personName"] = session["guest_name"]
            if session.get("person_id"):
                cleaned[index]["personId"] = session["person_id"]
            cleaned[index]["existingPerson"] = bool(session.get("existing_person"))
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


def require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required.")
    return value.strip()


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
    item = table.get_item(Key=key, ConsistentRead=True).get("Item")
    if not item or item.get("owner_id") != user_id:
        raise LookupError(f"{label} was not found.")
    return item


def delete_s3_object(key: str) -> None:
    s3.delete_object(Bucket=BUCKET_NAME, Key=key)


def decrement_person_photo_count(person_id: str) -> None:
    adjust_counter(people_table, person_id, "photo_count", -1)


def decrement_photo_match_count(photo_id: str) -> None:
    adjust_counter(photos_table, photo_id, "match_count", -1)


def increment_person_photo_count(person_id: str) -> None:
    adjust_counter(people_table, person_id, "photo_count", 1)


def increment_photo_match_count(photo_id: str) -> None:
    adjust_counter(photos_table, photo_id, "match_count", 1)


def adjust_counter(table: Any, item_id: str, field: str, delta: int) -> None:
    # Cleanup/review can overlap deletion; never recreate a row just to change its count.
    try:
        table.update_item(
            Key={"id": item_id},
            UpdateExpression="SET updated_at = :now ADD #count :delta",
            ExpressionAttributeNames={"#count": field},
            ExpressionAttributeValues={":delta": delta, ":now": iso_now()},
            ConditionExpression="attribute_exists(id)",
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


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


def signed_get_url(key: str, expires: int | None = None) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET_NAME, "Key": key},
        ExpiresIn=expires if expires is not None else URL_EXPIRES_SECONDS,
    )


def signed_download_url(key: str, filename: str) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET_NAME, "Key": key,
                "ResponseContentDisposition": f"attachment; filename*=UTF-8''{quote(safe_filename(filename), safe='')}"},
        ExpiresIn=300,
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
        "Cache-Control": "no-store",
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
