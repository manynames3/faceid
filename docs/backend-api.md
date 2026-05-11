# Backend API Contract

This frontend can run without a backend, but the production path uses a Cognito-authenticated AWS serverless API behind `VITE_API_BASE_URL`.

All AWS API routes require:

```text
Authorization: Bearer <cognito-id-token>
```

API Gateway validates the token with a Cognito JWT authorizer. Lambda scopes S3 keys and DynamoDB records to the authenticated user's Cognito `sub` claim and the selected event workspace. Upload processing also requires a short-lived upload session issued by `/uploads/presign`.

## Events

Events are private workspaces owned by the authenticated user. People, photos, matches, upload sessions, and S3 prefixes include an `eventId` so separate events can use the same guest names without mixing galleries.

If a request omits `eventId`, Lambda creates or uses a per-owner default event for backward compatibility with older records.

## Reference Uploads

Use uploaded filenames as the first person label:

```text
jane-smith.jpg -> Jane Smith
noah_kim_01.png -> Noah Kim
```

Server flow:

1. Issue an upload session and presigned S3 PUT URL.
2. Store the image in S3 under the authenticated user's reference prefix.
3. Verify the upload session, S3 object size, content type, and signed metadata.
4. Parse the filename into a display name.
5. Require consent confirmation from the authenticated owner.
6. Create or find the person in the selected event workspace.
7. Call Rekognition `IndexFaces` with the person identifier as metadata.
8. Save the Rekognition face ID, person ID, S3 key, source filename, event ID, and consent metadata.

Reference images are currently managed through the person record. Deleting a person removes their stored reference image keys, Rekognition face IDs, and related matches.

For events where guests may appear from different angles, upload multiple reference images for the same guest. A practical set is one front-facing image, one slight side angle, and one candid or event-like image. The backend caps the number of compared reference keys per person with `MAX_REFS_PER_PERSON`; raising it can improve recall for angle variation but also increases Rekognition calls.

## Photo Uploads

Server flow:

1. Issue an upload session and presigned S3 PUT URL.
2. Store the image in S3 under the authenticated user's photo prefix.
3. Verify the upload session, S3 object size, content type, and signed metadata.
4. Load the known people from DynamoDB, capped by `MAX_COMPARE_PEOPLE`.
5. Compare the uploaded photo against each person's stored reference keys, capped by `MAX_REFS_PER_PERSON`.
6. Call Rekognition `CompareFaces` for each bounded reference comparison.
7. Save matches above the production threshold as `matched`.
8. Save low-confidence matches as `needs_review`.
9. Return the photo asset with a short-lived preview URL and match results.

## Endpoints

```text
GET /library
GET /events
PATCH /matches/{photoId}/{personId}
POST /events
DELETE /people/{personId}
DELETE /photos/{photoId}
POST /uploads/presign
POST /uploads/process
```

The browser uploads directly to S3 by first requesting presigned PUT URLs, then asking the API to process those uploaded keys.

### POST /uploads/presign

Request:

```json
{
  "eventId": "event-uuid",
  "mode": "references",
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
  confidence: number;
  status: "matched" | "needs_review" | "approved" | "rejected" | "unknown";
  reviewedAt?: string;
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

### PATCH /matches/{photoId}/{personId}

Records a human review decision for one match owned by the authenticated user.

Request:

```json
{
  "status": "approved"
}
```

Allowed decision statuses are `approved` and `rejected`.

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

Deletes one person/reference record owned by the authenticated user. The Lambda function removes stored reference S3 objects, deletes indexed Rekognition face IDs, deletes related match rows, and decrements affected photo counters. Matched event photos remain in the library without that person's match.

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

Face matching is probabilistic. Treat `needs_review` as a normal workflow state when references are limited, guests are photographed from side angles, or event images include blur, low light, hats, glasses, or partial faces. Human reviewers can move candidate matches to `approved` or `rejected`.
