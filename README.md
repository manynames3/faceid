# FaceID

FaceID is a serverless photo-sorting web app that groups uploaded photos by recognizable people. The React frontend lets users drag in named reference photos, upload later event photos, review confidence scores, and browse each person's matched images. The production architecture is designed around Cloudflare Pages for the static app and an optional AWS serverless backend for private storage, Rekognition-based face comparison, and DynamoDB metadata.

**Live demo:** [https://faceid-8dc.pages.dev](https://faceid-8dc.pages.dev)

The hosted demo is connected to the Terraform-managed AWS backend. The app still supports local mock mode when `VITE_API_BASE_URL` is unset.

## About

This project demonstrates a pragmatic path from an interactive frontend prototype to a deployable serverless image-processing system. The UI is usable without a backend for review/demo purposes, while the AWS backend is defined in Terraform so the infrastructure can be created and destroyed repeatably.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **UI:** CSS modules-by-convention in `src/styles.css`, `lucide-react` icons
- **Hosting:** Cloudflare Pages, Wrangler
- **Backend:** AWS API Gateway HTTP API, Python 3.12 Lambda
- **Storage:** Private S3 bucket with presigned PUT and GET URLs
- **Face matching:** Amazon Rekognition `IndexFaces` for references and bounded `CompareFaces` checks for uploaded photos
- **Database:** DynamoDB tables for people, photos, and matches
- **Infrastructure:** Terraform with cost guardrails for throttling, batch size, and upload limits

## Engineering Highlights

- Direct browser-to-S3 uploads through presigned URLs, avoiding API Gateway payload limits for image files.
- Dual runtime mode: mock data for local/frontend review, real AWS API mode when `VITE_API_BASE_URL` is set.
- Reference-photo naming flow that derives people from filenames such as `jane-smith.jpg`.
- Private photo storage with short-lived signed preview URLs rather than public S3 objects.
- Explicit low-volume cost controls: max files per batch, upload size limits, bounded people/reference comparisons, API throttling, and short CloudWatch log retention.
- Terraform-managed backend resources with `terraform destroy` support for cleanup.
- Clear match states for user review: `matched`, `review`, and `unknown` in the shared API types.

## Architecture

The system is documented in:

- [Architecture Overview](docs/architecture.md)
- [Backend API Contract](docs/backend-api.md)
- [Architecture Decision Records](docs/adrs/README.md)
- [Terraform Deployment Notes](infra/terraform/README.md)

At a high level:

```text
Browser -> Cloudflare Pages React app -> AWS API Gateway -> Lambda
                                                    |-> S3
                                                    |-> Rekognition
                                                    |-> DynamoDB
```

## Local Development

```bash
npm install
npm run dev
```

The app runs in mock mode until `VITE_API_BASE_URL` is set.

## Validation

```bash
npm run lint
npm run build
python3 -m py_compile backend/lambda/app.py
terraform -chdir=infra/terraform validate
git diff --check
```

## Cloudflare Pages

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `22`

Set `VITE_API_BASE_URL` in Cloudflare Pages after the AWS API is deployed.

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

See [infra/terraform/README.md](infra/terraform/README.md) for variables, cost guardrails, and Cloudflare CORS setup.

## Privacy And Security Notes

- Uploaded photos are stored in a private S3 bucket.
- The frontend receives short-lived signed URLs for uploads and previews.
- The current public prototype does not include authentication or per-user isolation.
- The public Cloudflare demo is connected to AWS with conservative API throttles and upload limits.
- `force_destroy_bucket` defaults to `true` in Terraform so teardown removes uploaded assets.

## Limitations

- The MVP backend uses bounded `CompareFaces` checks against stored reference images; this is simple and deployable, but cost grows with `photos * people * references`.
- The current Lambda does not crop every face in group photos before searching. Large group-photo support would require a deeper face-detection/cropping pipeline.
- No production auth, moderation, or user consent workflow is included.
- The Cloudflare Pages deployment is static; backend environment wiring happens through `VITE_API_BASE_URL`.

## Project Structure

```text
backend/lambda/        Python Lambda API
docs/                  API, architecture, and ADR documentation
infra/terraform/       AWS serverless infrastructure
public/                Cloudflare Pages headers and redirects
src/                   React frontend
```
