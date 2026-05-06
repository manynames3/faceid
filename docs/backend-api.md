# Backend API Contract

This frontend can run without a backend, but the production path should use an AWS serverless API behind `VITE_API_BASE_URL`.

## Reference Uploads

Use uploaded filenames as the first person label:

```text
jane-smith.jpg -> Jane Smith
noah_kim_01.png -> Noah Kim
```

Server flow:

1. Store the image in S3 under a reference prefix.
2. Parse the filename into a display name.
3. Create or find the person in DynamoDB.
4. Call Rekognition `IndexFaces` with the person identifier as metadata.
5. Save the Rekognition face ID, person ID, S3 key, and source filename.

## Photo Uploads

Server flow:

1. Store the image in S3 under an intake prefix.
2. Load the known people from DynamoDB, capped by `MAX_COMPARE_PEOPLE`.
3. Compare the uploaded photo against each person's stored reference keys, capped by `MAX_REFS_PER_PERSON`.
4. Call Rekognition `CompareFaces` for each bounded reference comparison.
5. Save matches above the production threshold as `matched`.
6. Save low-confidence matches as `review`.
7. Return the photo asset with a short-lived preview URL and match results.

## Endpoints

```text
GET /library
POST /uploads/presign
POST /uploads/process
```

The browser uploads directly to S3 by first requesting presigned PUT URLs, then asking the API to process those uploaded keys.

### POST /uploads/presign

Request:

```json
{
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
      "key": "references/2026/05/03/uuid-jane-smith.jpg",
      "url": "https://s3-presigned-put-url",
      "headers": { "Content-Type": "image/jpeg" }
    }
  ]
}
```

### POST /uploads/process

Request:

```json
{
  "mode": "photos",
  "files": [
    {
      "name": "event-001.jpg",
      "key": "photos/2026/05/03/uuid-event-001.jpg",
      "size": 2200000,
      "type": "image/jpeg"
    }
  ]
}
```

Response:

```ts
type UploadResult = {
  people: Person[];
  photos: PhotoAsset[];
};

type Person = {
  id: string;
  name: string;
  referenceCount: number;
  photoCount: number;
  initials: string;
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
  status: "matched" | "review" | "unknown";
};
```

### GET /library

Returns the same `UploadResult` shape with all known people and recent photos.

## Thresholds

Start with:

- `matched`: 90% and above
- `review`: 75% to 89.9%
- `unknown`: below 75%

Tune thresholds with real photos before turning on bulk sorting.
