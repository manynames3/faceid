# FaceID

FaceID is a serverless private event-gallery app for photographers and event teams that groups uploaded event photos by recognizable guests. The React frontend supports guest reference intake, event photo uploads, confidence review, per-person galleries, and owner-controlled deletion. The production architecture is designed around Cloudflare Pages for the static app and a Cognito-authenticated AWS serverless backend for private storage, Rekognition-based face comparison, and DynamoDB metadata.

**Live demo:** [https://faceid-8dc.pages.dev](https://faceid-8dc.pages.dev)

The hosted demo is connected to the Terraform-managed AWS backend. The app still supports local mock mode when `VITE_API_BASE_URL` is unset.

## About

This project demonstrates a pragmatic path from an interactive frontend prototype to a deployable serverless image-processing system for private event photo delivery. The UI is usable without a backend for review/demo purposes, while the AWS backend is defined in Terraform so the infrastructure can be created and destroyed repeatably.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **UI:** CSS modules-by-convention in `src/styles.css`, `lucide-react` icons
- **Hosting:** Cloudflare Pages, Wrangler
- **Backend:** AWS API Gateway HTTP API, Cognito Hosted UI/JWT authorizer, Python 3.12 Lambda
- **Storage:** Private S3 bucket with presigned PUT and GET URLs
- **Face matching:** Amazon Rekognition `IndexFaces` for references and bounded `CompareFaces` checks for uploaded photos
- **Database:** DynamoDB tables for people, photos, matches, and short-lived upload sessions
- **Infrastructure:** Terraform with cost guardrails for throttling, batch size, and upload limits
- **Quality:** Vitest, Python `unittest`, GitHub Actions CI, Terraform validation

## Engineering Highlights

- Direct browser-to-S3 uploads through presigned URLs, avoiding API Gateway payload limits for image files.
- Dual runtime mode: mock data for local/frontend review, real AWS API mode when `VITE_API_BASE_URL` is set.
- Cognito sign-in with API Gateway JWT authorization and owner-scoped S3/DynamoDB records.
- DynamoDB-backed upload sessions that verify issued S3 keys, object size, content type, and upload metadata before processing.
- Owner-scoped delete flows for removing uploaded photos and reference/person records from S3, DynamoDB, and Rekognition.
- Event-gallery UX focused on guest reference intake, event photo upload, review queue triage, and per-person galleries.
- Focused frontend and backend tests for API upload contracts, auth context, and upload validation.
- GitHub Actions CI for linting, tests, frontend build, Lambda syntax, and Terraform validation.
- Structured Lambda logs, API Gateway access logs, CloudWatch alarms, and optional AWS Budget alerts.
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
Browser -> Cloudflare Pages React app -> Cognito + AWS API Gateway -> Lambda
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
npm test
npm run build
python3 -m py_compile backend/lambda/app.py
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform validate
git diff --check
```

## Cloudflare Pages

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `22`

Set these Cloudflare Pages environment variables after the AWS API is deployed:

```text
VITE_API_BASE_URL=<api_base_url>
VITE_AUTH_CLIENT_ID=<cognito_web_client_id>
VITE_AUTH_DOMAIN=<cognito_hosted_ui_domain>
```

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
- Cognito protects API routes with JWT authorization.
- Lambda scopes S3 keys and DynamoDB reads/writes to the authenticated Cognito user.
- Upload processing requires a valid upload session and verifies the S3 object before invoking Rekognition.
- Users can remove their uploaded photos and reference/person records; deletes remove private S3 objects and related metadata.
- Upload sessions are marked `processed` or `failed` so partial processing failures are visible in backend state.
- The public Cloudflare demo is connected to AWS with conservative API throttles and upload limits.
- `force_destroy_bucket` defaults to `true` in Terraform so teardown removes uploaded assets.

## Limitations

- The MVP backend uses bounded `CompareFaces` checks against stored reference images; this is simple and deployable, but cost grows with `photos * people * references`.
- The current Lambda does not crop every face in group photos before searching. Large group-photo support would require a deeper face-detection/cropping pipeline.
- No moderation, consent-management, admin review, or retention workflow is included.
- Reference images are managed at the person level in the current UI rather than as individually editable reference assets.
- The current frontend does not refresh Cognito tokens in place; users sign in again after the token expires.
- CI validates infrastructure and app code, but deployment is still intentionally manual.
- The Cloudflare Pages deployment is static; backend environment wiring happens through `VITE_API_BASE_URL`, `VITE_AUTH_CLIENT_ID`, and `VITE_AUTH_DOMAIN`.

## Project Structure

```text
backend/lambda/        Python Lambda API
.github/workflows/     CI validation workflow
docs/                  API, architecture, and ADR documentation
infra/terraform/       AWS serverless infrastructure
public/                Cloudflare Pages headers and redirects
src/                   React frontend
```
