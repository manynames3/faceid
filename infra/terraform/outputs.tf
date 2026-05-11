output "api_base_url" {
  description = "Set this as VITE_API_BASE_URL in Cloudflare Pages."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "asset_bucket_name" {
  description = "Private S3 bucket holding reference and uploaded photos."
  value       = aws_s3_bucket.assets.bucket
}

output "events_table_name" {
  description = "DynamoDB table holding event/workspace records."
  value       = aws_dynamodb_table.events.name
}

output "rekognition_collection_id" {
  description = "Rekognition face collection used for indexed reference faces."
  value       = aws_rekognition_collection.faces.collection_id
}

output "cognito_user_pool_id" {
  description = "Cognito user pool used by the frontend and API Gateway authorizer."
  value       = aws_cognito_user_pool.users.id
}

output "cognito_web_client_id" {
  description = "Set this as VITE_AUTH_CLIENT_ID in Cloudflare Pages."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_hosted_ui_domain" {
  description = "Set this as VITE_AUTH_DOMAIN in Cloudflare Pages."
  value       = "https://${aws_cognito_user_pool_domain.hosted_ui.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cloudflare_pages_env" {
  description = "Cloudflare Pages environment variables to set after terraform apply."
  value = join("\n", [
    "VITE_API_BASE_URL=${aws_apigatewayv2_stage.default.invoke_url}",
    "VITE_AUTH_CLIENT_ID=${aws_cognito_user_pool_client.web.id}",
    "VITE_AUTH_DOMAIN=https://${aws_cognito_user_pool_domain.hosted_ui.domain}.auth.${var.aws_region}.amazoncognito.com",
  ])
}
