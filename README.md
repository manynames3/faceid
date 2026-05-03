# Face Sorter

Cloudflare Pages frontend for a serverless photo workflow that groups uploaded photos by matched faces.

## Local Development

```bash
npm install
npm run dev
```

The app runs in mock mode until `VITE_API_BASE_URL` is set.

## Cloudflare Pages

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `22`

Set `VITE_API_BASE_URL` in Cloudflare Pages when the AWS API is deployed.

## AWS Backend

Terraform lives in `infra/terraform` and creates the serverless backend:

```bash
cd infra/terraform
terraform init
terraform apply
```

Destroy everything, including uploaded photos:

```bash
cd infra/terraform
terraform destroy
```

See `infra/terraform/README.md` for variables, cost guardrails, and Cloudflare CORS setup.

## Backend Shape

The frontend expects one upload endpoint:

```text
GET /library
POST /uploads/presign
POST /uploads/process
```

The frontend asks for presigned S3 PUT URLs, uploads images directly to S3, then calls `/uploads/process`.

Response:

```json
{
  "people": [
    {
      "id": "person-jane-smith",
      "name": "Jane Smith",
      "initials": "JS",
      "referenceCount": 1,
      "photoCount": 0
    }
  ],
  "photos": [
    {
      "id": "photo-123",
      "name": "event-001.jpg",
      "size": 2200000,
      "uploadedAt": "2026-05-03T12:00:00.000Z",
      "previewUrl": "https://signed-or-public-cdn-url.example/photo-123.jpg",
      "matches": [
        {
          "personId": "person-jane-smith",
          "personName": "Jane Smith",
          "confidence": 97.4,
          "status": "matched"
        }
      ]
    }
  ]
}
```

Recommended AWS implementation:

- S3 for original/reference photos.
- Lambda for upload finalization and Rekognition processing.
- Rekognition collections for `IndexFaces` and `SearchFacesByImage`.
- DynamoDB for people, photo assets, face matches, and review status.
- API Gateway or Lambda Function URLs for the frontend API.
- CloudFront or short-lived signed URLs for private photo previews.
