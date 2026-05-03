# AWS Serverless Terraform

This creates the low-volume AWS backend for the Cloudflare Pages frontend:

- Private S3 bucket for reference and uploaded photos
- API Gateway HTTP API
- Python Lambda API
- DynamoDB tables for people, photos, and matches
- Rekognition face collection
- CloudWatch log retention

## Cost Notes

The idle stack should be near zero cost. At low volume, most usage can fit into AWS free-tier allowances on eligible accounts. The main variable cost is Rekognition:

```text
photo processing calls ~= uploaded photos * min(people, max_compare_people) * max_refs_per_person
```

Keep `max_compare_people`, `max_refs_per_person`, and `max_files_per_batch` conservative until you test real volume. The default Lambda reserved concurrency and API throttles are intentionally low for cost control.

## Deploy

```bash
cd infra/terraform
terraform init
terraform apply
```

After apply, copy the `api_base_url` output into Cloudflare Pages:

```text
VITE_API_BASE_URL=<api_base_url>
```

For local development, add it to `.env`:

```bash
VITE_API_BASE_URL=<api_base_url>
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
