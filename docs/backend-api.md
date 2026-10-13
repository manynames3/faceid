# Backend API Contract

This frontend can run without a backend, but the production path uses a Cognito-authenticated AWS serverless API behind `VITE_API_BASE_URL`.

Owner AWS API routes require:

```text
Authorization: Bearer <cognito-id-token>
```

API Gateway validates the token with a Cognito JWT authorizer. Lambda scopes S3 keys and DynamoDB records to the authenticated user's Cognito `sub` claim and the selected event workspace. Upload processing also requires a short-lived upload session issued by `/uploads/presign`.

## Events

Events are private workspaces owned by the authenticated user. People, photos, matches, upload sessions, and S3 prefixes include an `eventId` so separate events can use the same guest names without mixing galleries.

If a request omits `eventId`, Lambda creates or uses a per-owner default event for backward compatibility with older records.

## Reference Uploads

### Guest Signup

The JWT-protected `GET /events/{event_id}/intake-link` returns an event-specific `/guest?eventId=...&token=...` signup URL. The token is an HMAC capability, not an AWS credential or guest identity check. It does not automatically expire. Closing signup blocks new presigns and processing requests; reopening increments the event's invitation version and invalidates its older links. Version-zero events retain legacy tokens until closed and reopened. The server signing secret stays private; rotating it invalidates all existing links.

`GET /guest-intake?eventId=...&token=...` verifies the capability and returns only `eventId`, `eventName`, `hostName`, `contactEmail` and `signupOpen`. Closed links still show the host's details, but cannot submit references. `POST /guest-intake/presign` accepts that pair, `guestName` and file metadata; it issues reference-only upload sessions for a new guest. `POST /guest-intake/process` accepts the same pair/name, the uploaded files and `consent: {confirmed: true, source: "guest_submitted"}`. Processing verifies the issued name, session, owner/event scope and S3 metadata. These public routes do not accept event-photo processing or expose the owner's library. New owner-issued sessions cannot be relabeled as guest-submitted; legacy guest sessions remain compatible.

The public frontend does not send a host JWT with guest requests. Owner intake instead requires `owner_attested` permission. Both paths store the source/time and return the authoritative profile plus any no-face warnings. These records are not verified identity or legal-compliance guarantees.

The owner workspace submits an explicit `guestName` with one or two reference photos. Lambda preserves the display name and creates one opaque person identifier for the whole submission, so two guests with the same name remain distinct. Optional `personId` adds references to an existing guest after ownership and event checks.

Guest identity is bound to the upload session at presign time. Processing reads that trusted identity from the session and rejects a different supplied guest name or person identifier. A deleted guest cannot be recreated by processing their pending reference session.

Older API clients that omit `guestName` and `personId` retain the filename-based label behavior:

```text
jane-smith.jpg -> Jane Smith
noah_kim_01.png -> Noah Kim
```

Server flow:

1. Issue an upload session and presigned S3 PUT URL.
2. Store the image in S3 under the authenticated user's reference prefix.
3. Verify the upload session, S3 object size, content type, and signed metadata.
4. Resolve the guest name and identifier from the issued session (or filename for legacy clients).
5. Require consent confirmation from the authenticated owner.
6. Create or update the owner/event-scoped guest record.
7. Call Rekognition `IndexFaces` with the person identifier as metadata.
8. Save the Rekognition face ID, person ID, S3 key, source filename, event ID, and consent metadata.

Reference images are currently managed through the person record. Deleting a person removes their stored reference image keys, Rekognition face IDs, and related matches.

For angle variation, use one front-facing image and one slight side angle. Named intake enforces `MAX_REFS_PER_PERSON` (default two), because only that many reference keys are compared. Adding references does not automatically reprocess uploaded photos. The owner can explicitly rematch a guest against selected existing photos. References with no detected face return an actionable warning and their unusable S3 object is removed.

### Interrupted Guest Submissions

`POST /guest-intake/status` accepts `{eventId, token, uploadIds}`. It verifies the current event capability and every session's owner, event, reference mode, guest source and shared person ID. Consistent reads return `pending`, `saved`, `partial` or `not_saved`, the saved reference count, and the submitted name only when a reference exists. It never repeats processing. Duplicate/empty IDs and unrelated sessions are rejected. All JSON API responses use `Cache-Control: no-store`.

The browser keeps only issued upload IDs in tab-scoped session storage before requesting processing, so a reload after a timeout can check the same submission. It blocks a second signup while the result is uncertain. Expired/removed receipts, revoked links or stuck processing require the host's help; this is recovery checking, not a durable job queue.

## Photo Uploads

Server flow:

1. Issue an upload session and presigned S3 PUT URL.
2. Store the image in S3 under the authenticated user's photo prefix.
3. Verify the upload session, S3 object size, content type, and signed metadata.
4. Load known guests from DynamoDB and reject empty reference sets or events exceeding `MAX_COMPARE_PEOPLE`, rather than truncating the guest list.
5. Compare the uploaded photo against each person's stored reference keys, capped by `MAX_REFS_PER_PERSON`.
6. Call Rekognition `CompareFaces` for each bounded reference comparison.
7. Save matches above the production threshold as `matched`.
8. Save low-confidence matches as `needs_review`.
9. Return the photo asset with a short-lived preview URL and match results.

## Endpoints

```text
GET /library
GET /events
GET /events/{event_id}/intake-link
PATCH /events/{event_id}
GET /photos/{photoId}/download
POST /photos/{photoId}/guests
POST /photos/{photoId}/rematch
POST /people/{personId}/gallery-link
DELETE /people/{personId}/gallery-link
GET /guest-gallery
GET /guest-gallery/photos/{photoId}/download
PATCH /matches/{photoId}/{personId}
POST /events
DELETE /people/{personId}
DELETE /photos/{photoId}
POST /uploads/presign
POST /uploads/process
GET /guest-intake
POST /guest-intake/presign
POST /guest-intake/process
POST /guest-intake/status
```

The browser uploads directly to S3 by first requesting presigned PUT URLs, then asking the API to process those uploaded keys.

Inputs must be non-empty JPEG or PNG files, with the configured size and batch limits. This follows [Rekognition's supported image formats and quotas](https://docs.aws.amazon.com/rekognition/latest/dg/limits.html). The browser uses one event photo per processing request to keep results and failures visible independently. This does not turn the synchronous Lambda into a durable background job.

### POST /uploads/presign

Request:

```json
{
  "eventId": "event-uuid",
  "mode": "references",
  "guestName": "Jane McDonald",
  "files": [
    { "name": "jane-smith.jpg", "size": 1200000, "type": "image/jpeg" }
  ]
}
```

Response:

```json
{
  "uploads": [
    {
      "name": "jane-smith.jpg",
      "uploadId": "upload-uuid",
      "key": "users/<owner>/events/<event-id>/references/2026/05/03/uuid-jane-smith.jpg",
      "url": "https://s3-presigned-put-url",
      "headers": {
        "Content-Type": "image/jpeg",
        "x-amz-meta-upload-id": "upload-uuid"
      }
    }
  ]
}
```

### POST /uploads/process

Request:

```json
{
  "eventId": "event-uuid",
  "mode": "references",
  "guestName": "Jane McDonald",
  "consent": {
    "confirmed": true,
    "source": "owner_attested"
  },
  "files": [
    {
      "name": "jane-smith.jpg",
      "uploadId": "upload-uuid",
      "key": "users/<owner>/events/<event-id>/references/2026/05/03/uuid-jane-smith.jpg",
      "size": 1200000,
      "type": "image/jpeg"
    }
  ]
}
```

For `mode: "photos"`, omit `consent` and use uploaded photo keys under the selected event's `photos` prefix.

Response:

```ts
type UploadResult = {
  people: Person[];
  photos: PhotoAsset[];
  warnings?: string[];
};

type LibraryResult = UploadResult & {
  event?: EventWorkspace;
  events?: EventWorkspace[];
};

type EventWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  status: "active";
  hostName?: string;
  contactEmail?: string;
  signupOpen?: boolean;
  guestCount?: number;
  photoCount?: number;
  reviewCount?: number;
};

type Person = {
  id: string;
  name: string;
  referenceCount: number;
  photoCount: number;
  initials: string;
  consentStatus?: "captured" | "unknown";
  consentSource?: string;
  consentCapturedAt?: string;
  referencePreviewUrl?: string;
};

type PhotoAsset = {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  previewUrl: string;
  matches: PhotoMatch[];
};

type PhotoMatch = {
  personId: string;
  personName: string;
  confidence?: number;
  source?: "face_match" | "manual";
  status: "matched" | "needs_review" | "approved" | "rejected" | "unknown";
  reviewedAt?: string;
  faceBox?: { left: number; top: number; width: number; height: number };
};
```

### GET /library

Returns the selected event, the owner's event list, and the selected event's known people and recent photos. Use `?eventId=<event-id>` to load a specific workspace.

### GET /events

Returns private event workspaces owned by the authenticated user.

### POST /events

Request:

```json
{
  "name": "Spring Gala"
}
```

Response:

```json
{
  "event": {
    "id": "event-uuid",
    "name": "Spring Gala",
    "createdAt": "2026-05-11T00:00:00Z",
    "status": "active"
  }
}
```

### PATCH /events/{event_id}

Owner-only settings: `{name?, hostName?, contactEmail?, signupOpen?}`. Event/host names are bounded and contact email is validated. Opening a previously closed event increments its invitation version. Conditional writes prevent a concurrent settings update from restoring an older invitation version or signup state. Unchanged signup controls are omitted by the UI. The owner can close intake without deleting guests; in-flight processing that already passed authorization is not cancelled, and already-issued S3 PUT links remain usable until expiry (but a new processing request is blocked).

### GET /photos/{photoId}/download

Owner-only endpoint returning `{url, filename}` after photo ownership checks. The S3 URL lasts five minutes and requests `Content-Disposition: attachment`. It downloads the original object; it is not a guest share link. The Deliver view offers these downloads only for approved rows, while the endpoint allows the owner access to their own photos. Do not export signed links into CSV or logs.

### PATCH /matches/{photoId}/{personId}

Records a human review decision for one match owned by the authenticated user.

Request:

```json
{
  "status": "approved"
}
```

Allowed decision statuses are `approved` and `rejected`.

Decisions can be changed to the opposite outcome through the same endpoint. There is no reset-to-pending API. Both `matched` and `needs_review` remain unconfirmed until an owner decision.

## Guest Gallery Delivery

JWT-protected `POST /people/{personId}/gallery-link` creates or replaces a seven-day link after owner, consent and approval checks. Optional `{photoId}` identifies a just-approved photo for a consistent primary-key read while the secondary index catches up. That photo ID is stored as a gallery hint and reauthorized on every request; it cannot bypass approval. The random 256-bit capability is hashed together with the guest ID; the person record stores the hash, expiry, enabled flag and photo hint, never the raw token. The response includes `galleryUrl`, `expiresAt` and the updated person. The raw URL stays only in the active workspace's memory for repeat copying. After a reload, creating a replacement invalidates the earlier link. `DELETE` on the same route disables access.

Public `GET /guest-gallery?personId=...&token=...` verifies the guest-bound capability, expiry, enabled state and recorded permission. It queries the existing person index, then consistently rereads each match and photo before including it. Both records must belong to the same owner/event, and the match must be approved. The response contains event/host/contact/guest names, expiry and photo IDs/names/preview URLs; no references, guest list, other match identities or scores are exposed. Images are whole photos, so they can include other guests.

`GET /guest-gallery/photos/{photoId}/download` uses the same query parameters and repeats authorization and approval checks before issuing a five-minute attachment URL. Rejection, deletion, expiry or link disablement blocks future API requests. Signed image URLs already issued can work for five minutes; downloaded copies cannot be recalled. Share links privately. No delivery email is sent by the app.

## Manual Corrections And Rematching

`POST /photos/{photoId}/guests` accepts `{eventId, personId}`. It checks ownership, event scope and consent, then records an approved manual match, without a confidence score. The UI requires explicit confirmation after showing the event image and guest reference. The match and both counters are written in one conditional DynamoDB transaction, so deletion or a competing decision cannot leave half an assignment. Repeating an already-approved assignment returns the existing record.

`POST /photos/{photoId}/rematch` accepts `{eventId, personId, requestId}`. Each request compares only this guest's capped references with one stored photo; no re-upload is needed. Approved/rejected records are kept unchanged. Pending candidates can be updated, and new candidates still require review. A no-match result doesn't delete an earlier pending candidate or imply the guest is absent.

A TTL-backed operation record in the existing uploads table binds the request ID to owner/event/photo/guest. Processed requests replay without another Rekognition call; pending requests return 409, and failed attempts require a new request ID. Conditional transactions prevent a concurrent human decision from being overwritten. The client selects at most 50 photos and shows progress/results; uncertain retries retain their request IDs. This is bounded synchronous processing, not a durable background queue. Closing/reloading the search loses client progress, although completed matches remain saved.

Manual provenance is preserved when decisions change, and CSV similarity stays blank for manual assignments. The CSV includes a final `match_source` column. Legacy scored matches default to `face_match`.

## Delivery Export

The browser exports only approved guest/photo rows, grouped by stable guest identifiers. The manifest includes event, guest and photo identifiers, guest name, source filename, match similarity and review time. It quotes CSV cells and protects formula-prefixed names. It intentionally omits signed preview URLs, which are temporary bearer access to private images. This export has no new API endpoint; guest gallery publication is the separate capability-based flow above.

### DELETE /photos/{photoId}

Deletes one uploaded photo owned by the authenticated user. The Lambda function removes the private S3 object, deletes the photo row, deletes the photo's match rows, and decrements affected people counters.

Response:

```json
{
  "deletedPhotoId": "photo-id",
  "deletedMatches": 1
}
```

### DELETE /people/{personId}

Deletes one person/reference record owned by the authenticated user. The Lambda first sets `deletion_pending` and disables the gallery, then removes stored reference S3 objects, indexed Rekognition face IDs and related match rows, decrementing affected photo counters. New reference and match writes reject the removal marker. A cleanup failure leaves a visible, retryable removal state, not an active gallery. Matched event photos remain in the library without that person's match. Cleanup/review counter writes cannot recreate removed people/photos.

Response:

```json
{
  "deletedPersonId": "person-id",
  "deletedMatches": 2,
  "deletedReferenceImages": 1
}
```

## Thresholds

Start with:

- `matched`: 90% and above
- `needs_review`: 75% to 89.9%
- `unknown`: below 75%

Tune thresholds with real photos before turning on bulk sorting.

New match records retain the normalized bounding box from the highest-scoring comparison. Review draws a non-obscuring outline over the uncropped image, accounting for letterboxing. Old records without a box remain reviewable. Boxes show the suggested face, not a verified identity.

Face matching is probabilistic. Treat `needs_review` as a normal workflow state when references are limited, guests are photographed from side angles, or event images include blur, low light, hats, glasses, or partial faces. Human reviewers can move candidate matches to `approved` or `rejected`.
