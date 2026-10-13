# AWS Serverless Terraform

This creates the low-volume AWS backend for the Cloudflare Pages frontend:

- Private S3 bucket for reference and uploaded photos
- Cognito user pool, Hosted UI domain, and web app client
- API Gateway HTTP API
- API Gateway JWT authorizer
- Event-scoped guest signup routes with a server-side HMAC signing secret
- Python Lambda API
- On-demand DynamoDB tables for events, owner-scoped people, photos, matches, and upload sessions
- Rekognition face collection
- CloudWatch Lambda logs, API access logs, and failure alarms
- Optional AWS Budget email alert

## Cost Notes

The idle stack should be near zero cost. At low volume, most usage can fit into AWS free-tier allowances on eligible accounts. DynamoDB uses on-demand billing so it is not configured with always-on read/write capacity. The main variable cost is Rekognition:

```text
photo processing calls ~= uploaded photos * min(people, max_compare_people) * max_refs_per_person
```

Keep `max_compare_people`, `max_refs_per_person`, and `max_files_per_batch` conservative until you test real volume. The default API throttles are intentionally low for cost control.

Upload sessions are stored in DynamoDB with TTL enabled. They add low-volume DynamoDB write/read usage but avoid keeping issued S3 keys valid for arbitrary processing.

CloudWatch alarms are enabled by default and should stay low cost at this scale. Set `alarm_email` to receive email notifications through SNS. Set `budget_alert_email` to create an account-level monthly AWS Budget alert; leave it blank to skip budget creation.

## Deploy

For a new stack, Terraform generates the guest signing secret and stores it in the Lambda environment and sensitive Terraform state. Do not commit state or `.tfvars` files. When importing an existing stack, securely supply its existing secret as `TF_VAR_intake_token_secret` to preserve guest links. Replacing the secret invalidates all previously shared links.

This release checkout has no original production Terraform state. Do not apply or destroy from an empty state against the existing deployment: recover the original state or import the live resources first. Code-only releases can update the existing Lambda ZIP without changing its environment, preserving the signing secret and stored photos.

The invitation-controls release also needs three API Gateway routes, not just a Lambda ZIP: JWT-protected `PATCH /events/{event_id}` and `GET /photos/{photo_id}/download`, plus public `POST /guest-intake/status` (capability-checked inside Lambda). Deploy backend code and these routes before the frontend. Preserve the existing signing secret, integrations, authorizer and throttles. No new service, table or paid subscription is introduced. Check an existing invitation, close/reopen behavior and an owner-only download after release. Do not claim local mock-API checks verify the deployed AWS path.

The delivery/correction release adds six more routes in `main.tf`:

- JWT-protected `POST /photos/{photo_id}/guests` and `POST /photos/{photo_id}/rematch`.
- JWT-protected `POST /people/{person_id}/gallery-link` and `DELETE /people/{person_id}/gallery-link`.
- Public `GET /guest-gallery` and `GET /guest-gallery/photos/{photo_id}/download`, each capability-checked inside Lambda.

Publish Lambda and routes before the frontend. Existing table indexes and Put/Update IAM actions support the match transactions; no new service or table is needed. Reload open host tabs before using manual assignments: old frontend builds assumed every match had a numeric similarity. Smoke-test approval, guest-link creation, download, rejection and revocation after release. Public gallery images use five-minute signed URLs; already-issued URLs can outlive revocation for that interval.

```bash
cd infra/terraform
terraform init
terraform apply
```

After apply, copy the `cloudflare_pages_env` output into Cloudflare Pages:

```text
VITE_API_BASE_URL=<api_base_url>
VITE_AUTH_CLIENT_ID=<cognito_web_client_id>
VITE_AUTH_DOMAIN=<cognito_hosted_ui_domain>
```

For local development, add it to `.env`:

```bash
VITE_API_BASE_URL=<api_base_url>
VITE_AUTH_CLIENT_ID=<cognito_web_client_id>
VITE_AUTH_DOMAIN=<cognito_hosted_ui_domain>
```

## Destroy

```bash
cd infra/terraform
terraform destroy
```

`force_destroy_bucket` defaults to `true`, so destroying the stack deletes uploaded photos.

## Production CORS

Before using a Cloudflare Pages domain, add it to `allowed_origins`:

```hcl
allowed_origins = [
  "http://localhost:5173",
  "https://your-site.pages.dev"
]
```

Also add the same browser origins to Cognito callback and logout URLs:

```hcl
auth_callback_urls = [
  "http://localhost:5173",
  "https://your-site.pages.dev"
]

auth_logout_urls = [
  "http://localhost:5173",
  "https://your-site.pages.dev"
]
```
