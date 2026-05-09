data "aws_caller_identity" "current" {}

locals {
  name_prefix     = replace(lower(var.project_name), "_", "-")
  lambda_src_dir  = "${path.module}/../../backend/lambda"
  lambda_zip_path = "${path.module}/lambda.zip"
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

  global_secondary_index {
    name            = "person_id-photo_id-index"
    hash_key        = "person_id"
    range_key       = "photo_id"
    projection_type = "ALL"
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
      ALLOWED_ORIGINS     = join(",", var.allowed_origins)
      BUCKET_NAME         = aws_s3_bucket.assets.bucket
      COLLECTION_ID       = aws_rekognition_collection.faces.collection_id
      MATCHED_THRESHOLD   = tostring(var.matched_threshold)
      MATCHES_TABLE       = aws_dynamodb_table.matches.name
      MAX_COMPARE_PEOPLE  = tostring(var.max_compare_people)
      MAX_FILES_PER_BATCH = tostring(var.max_files_per_batch)
      MAX_REFS_PER_PERSON = tostring(var.max_refs_per_person)
      MAX_UPLOAD_MB       = tostring(var.max_upload_mb)
      PEOPLE_TABLE        = aws_dynamodb_table.people.name
      PHOTOS_TABLE        = aws_dynamodb_table.photos.name
      REVIEW_THRESHOLD    = tostring(var.review_threshold)
      URL_EXPIRES_SECONDS = tostring(var.url_expires_seconds)
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

resource "aws_apigatewayv2_route" "library" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /library"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "presign" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /uploads/presign"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "process" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /uploads/process"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.api_throttle_burst_limit
    throttling_rate_limit  = var.api_throttle_rate_limit
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
