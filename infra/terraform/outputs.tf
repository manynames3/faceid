output "api_base_url" {
  description = "Set this as VITE_API_BASE_URL in Cloudflare Pages."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "asset_bucket_name" {
  description = "Private S3 bucket holding reference and uploaded photos."
  value       = aws_s3_bucket.assets.bucket
}

output "rekognition_collection_id" {
  description = "Rekognition face collection used for indexed reference faces."
  value       = aws_rekognition_collection.faces.collection_id
}

output "cloudflare_pages_env" {
  description = "Cloudflare Pages environment variable to set after terraform apply."
  value       = "VITE_API_BASE_URL=${aws_apigatewayv2_stage.default.invoke_url}"
}
