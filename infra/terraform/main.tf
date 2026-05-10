data "aws_caller_identity" "current" {}

locals {
  name_prefix     = replace(lower(var.project_name), "_", "-")
  lambda_src_dir  = "${path.module}/../../backend/lambda"
  lambda_zip_path = "${path.module}/lambda.zip"
  alarm_actions   = var.alarm_email == "" ? [] : [aws_sns_topic.alerts[0].arn]
  common_tags = {
    Project   = var.project_name
    ManagedBy = "terraform"
  }
}

resource "random_id" "suffix" {
  byte_length = 3
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.lambda_src_dir
  output_path = local.lambda_zip_path
}

resource "aws_cognito_user_pool" "users" {
  name = "${local.name_prefix}-users-${random_id.suffix.hex}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web-client"
  user_pool_id = aws_cognito_user_pool.users.id

  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = var.auth_callback_urls
  logout_urls                          = var.auth_logout_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 7

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "hosted_ui" {
  domain       = substr("${local.name_prefix}-${data.aws_caller_identity.current.account_id}-${random_id.suffix.hex}", 0, 63)
  user_pool_id = aws_cognito_user_pool.users.id
}

resource "aws_s3_bucket" "assets" {
  bucket        = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-${var.aws_region}-${random_id.suffix.hex}"
  force_destroy = var.force_destroy_bucket
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

resource "aws_rekognition_collection" "faces" {
  collection_id = "${local.name_prefix}-${random_id.suffix.hex}"
  tags          = local.common_tags
}

resource "aws_dynamodb_table" "people" {
  name         = "${local.name_prefix}-people"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "owner_id"
    type = "S"
  }

  attribute {
    name = "name"
    type = "S"
  }

  global_secondary_index {
    name            = "owner_id-name-index"
    hash_key        = "owner_id"
    range_key       = "name"
    projection_type = "ALL"
  }

  tags = local.common_tags
}

resource "aws_dynamodb_table" "photos" {
  name         = "${local.name_prefix}-photos"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "owner_id"
    type = "S"
  }

  attribute {
    name = "uploaded_at"
    type = "S"
  }

  global_secondary_index {
    name            = "owner_id-uploaded_at-index"
    hash_key        = "owner_id"
    range_key       = "uploaded_at"
    projection_type = "ALL"
  }

  tags = local.common_tags
}

resource "aws_dynamodb_table" "matches" {
  name         = "${local.name_prefix}-matches"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "photo_id"
  range_key    = "person_id"

  attribute {
    name = "photo_id"
    type = "S"
  }

  attribute {
    name = "person_id"
    type = "S"
  }

  attribute {
    name = "owner_id"
    type = "S"
  }

  global_secondary_index {
    name            = "person_id-photo_id-index"
    hash_key        = "person_id"
    range_key       = "photo_id"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "owner_id-photo_id-index"
    hash_key        = "owner_id"
    range_key       = "photo_id"
    projection_type = "ALL"
  }

  tags = local.common_tags
}

resource "aws_dynamodb_table" "upload_sessions" {
  name         = "${local.name_prefix}-upload-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = local.common_tags
}

resource "aws_iam_role" "lambda" {
  name = "${local.name_prefix}-api-lambda-${random_id.suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name_prefix}-api-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.assets.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.assets.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.people.arn,
          aws_dynamodb_table.photos.arn,
          aws_dynamodb_table.matches.arn,
          aws_dynamodb_table.upload_sessions.arn,
          "${aws_dynamodb_table.people.arn}/index/*",
          "${aws_dynamodb_table.photos.arn}/index/*",
          "${aws_dynamodb_table.matches.arn}/index/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "rekognition:CompareFaces",
          "rekognition:IndexFaces"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name_prefix}-api-${random_id.suffix.hex}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.name_prefix}-http-api-${random_id.suffix.hex}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_sns_topic" "alerts" {
  count = var.alarm_email == "" ? 0 : 1

  name = "${local.name_prefix}-alerts-${random_id.suffix.hex}"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count = var.alarm_email == "" ? 0 : 1

  endpoint  = var.alarm_email
  protocol  = "email"
  topic_arn = aws_sns_topic.alerts[0].arn
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count = var.enable_cloudwatch_alarms ? 1 : 0

  alarm_actions       = local.alarm_actions
  alarm_description   = "Lambda reported at least one error in a 5-minute period."
  alarm_name          = "${local.name_prefix}-lambda-errors-${random_id.suffix.hex}"
  comparison_operator = "GreaterThanThreshold"
  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
  evaluation_periods = 1
  metric_name        = "Errors"
  namespace          = "AWS/Lambda"
  ok_actions         = local.alarm_actions
  period             = 300
  statistic          = "Sum"
  tags               = local.common_tags
  threshold          = 0
  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  count = var.enable_cloudwatch_alarms ? 1 : 0

  alarm_actions       = local.alarm_actions
  alarm_description   = "Lambda was throttled in a 5-minute period."
  alarm_name          = "${local.name_prefix}-lambda-throttles-${random_id.suffix.hex}"
  comparison_operator = "GreaterThanThreshold"
  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
  evaluation_periods = 1
  metric_name        = "Throttles"
  namespace          = "AWS/Lambda"
  ok_actions         = local.alarm_actions
  period             = 300
  statistic          = "Sum"
  tags               = local.common_tags
  threshold          = 0
  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count = var.enable_cloudwatch_alarms ? 1 : 0

  alarm_actions       = local.alarm_actions
  alarm_description   = "API Gateway returned at least one 5xx response in a 5-minute period."
  alarm_name          = "${local.name_prefix}-api-5xx-${random_id.suffix.hex}"
  comparison_operator = "GreaterThanThreshold"
  dimensions = {
    ApiId = aws_apigatewayv2_api.http.id
    Stage = aws_apigatewayv2_stage.default.name
  }
  evaluation_periods = 1
  metric_name        = "5xx"
  namespace          = "AWS/ApiGateway"
  ok_actions         = local.alarm_actions
  period             = 300
  statistic          = "Sum"
  tags               = local.common_tags
  threshold          = 0
  treat_missing_data = "notBreaching"
}

resource "aws_budgets_budget" "monthly" {
  count = var.budget_alert_email == "" ? 0 : 1

  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_limit_usd)
  limit_unit   = "USD"
  name         = "${local.name_prefix}-monthly-budget"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
  }
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name_prefix}-api-${random_id.suffix.hex}"
  role             = aws_iam_role.lambda.arn
  handler          = "app.handler"
  runtime          = "python3.12"
  architectures    = ["arm64"]
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 60
  memory_size      = 512

  environment {
    variables = {
      ALLOWED_ORIGINS            = join(",", var.allowed_origins)
      BUCKET_NAME                = aws_s3_bucket.assets.bucket
      COLLECTION_ID              = aws_rekognition_collection.faces.collection_id
      MATCHED_THRESHOLD          = tostring(var.matched_threshold)
      MATCHES_OWNER_INDEX        = "owner_id-photo_id-index"
      MATCHES_TABLE              = aws_dynamodb_table.matches.name
      MAX_COMPARE_PEOPLE         = tostring(var.max_compare_people)
      MAX_FILES_PER_BATCH        = tostring(var.max_files_per_batch)
      MAX_REFS_PER_PERSON        = tostring(var.max_refs_per_person)
      MAX_UPLOAD_MB              = tostring(var.max_upload_mb)
      PEOPLE_OWNER_INDEX         = "owner_id-name-index"
      PEOPLE_TABLE               = aws_dynamodb_table.people.name
      PHOTOS_OWNER_INDEX         = "owner_id-uploaded_at-index"
      PHOTOS_TABLE               = aws_dynamodb_table.photos.name
      REVIEW_THRESHOLD           = tostring(var.review_threshold)
      UPLOADS_TABLE              = aws_dynamodb_table.upload_sessions.name
      UPLOAD_SESSION_TTL_SECONDS = tostring(var.upload_session_ttl_seconds)
      URL_EXPIRES_SECONDS        = tostring(var.url_expires_seconds)
    }
  }

  tags = local.common_tags

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda
  ]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type", "authorization"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = var.allowed_origins
    max_age       = 300
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name_prefix}-cognito"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }
}

resource "aws_apigatewayv2_route" "library" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /library"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "presign" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /uploads/presign"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "process" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /uploads/process"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      error              = "$context.error.message"
      httpMethod         = "$context.httpMethod"
      integrationError   = "$context.integrationErrorMessage"
      integrationLatency = "$context.integrationLatency"
      ip                 = "$context.identity.sourceIp"
      protocol           = "$context.protocol"
      requestId          = "$context.requestId"
      requestTime        = "$context.requestTime"
      responseLength     = "$context.responseLength"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
    })
  }

  default_route_settings {
    detailed_metrics_enabled = true
    throttling_burst_limit   = var.api_throttle_burst_limit
    throttling_rate_limit    = var.api_throttle_rate_limit
  }

  tags = local.common_tags
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
