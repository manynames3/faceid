variable "project_name" {
  description = "Short name used in AWS resource names."
  type        = string
  default     = "face-sorter"
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "allowed_origins" {
  description = "Browser origins allowed to call the API and upload to S3. Add your Cloudflare Pages URL here."
  type        = list(string)
  default     = ["http://localhost:5173", "https://faceid-8dc.pages.dev"]
}

variable "auth_callback_urls" {
  description = "Allowed Cognito Hosted UI callback URLs for the frontend."
  type        = list(string)
  default     = ["http://localhost:5173", "https://faceid-8dc.pages.dev"]
}

variable "auth_logout_urls" {
  description = "Allowed Cognito Hosted UI logout redirect URLs for the frontend."
  type        = list(string)
  default     = ["http://localhost:5173", "https://faceid-8dc.pages.dev"]
}

variable "matched_threshold" {
  description = "Rekognition similarity percentage treated as an automatic match."
  type        = number
  default     = 90
}

variable "review_threshold" {
  description = "Rekognition similarity percentage that enters manual review."
  type        = number
  default     = 75
}

variable "max_refs_per_person" {
  description = "Maximum reference images compared per person for each uploaded photo."
  type        = number
  default     = 2
}

variable "max_compare_people" {
  description = "Maximum people compared against each uploaded photo. This is the main cost guardrail."
  type        = number
  default     = 50
}

variable "max_files_per_batch" {
  description = "Maximum images accepted in a single frontend batch."
  type        = number
  default     = 10
}

variable "max_upload_mb" {
  description = "Maximum upload size per image."
  type        = number
  default     = 15
}

variable "upload_session_ttl_seconds" {
  description = "Seconds before issued upload sessions expire and become eligible for DynamoDB TTL cleanup."
  type        = number
  default     = 3600
}

variable "url_expires_seconds" {
  description = "Expiration time for private S3 preview URLs returned to the frontend."
  type        = number
  default     = 3600
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Lambda logs."
  type        = number
  default     = 7
}

variable "enable_cloudwatch_alarms" {
  description = "Create lightweight CloudWatch alarms for Lambda and API failures."
  type        = bool
  default     = true
}

variable "alarm_email" {
  description = "Optional email address for CloudWatch alarm notifications. Leave blank to create alarms without notifications."
  type        = string
  default     = ""
}

variable "budget_alert_email" {
  description = "Optional email address for AWS Budget alerts. Leave blank to skip budget creation."
  type        = string
  default     = ""
}

variable "monthly_budget_limit_usd" {
  description = "Monthly account-level AWS Budget amount when budget_alert_email is set."
  type        = number
  default     = 10
}

variable "api_throttle_burst_limit" {
  description = "API Gateway burst limit for the default stage."
  type        = number
  default     = 5
}

variable "api_throttle_rate_limit" {
  description = "API Gateway steady-state requests per second for the default stage."
  type        = number
  default     = 2
}

variable "force_destroy_bucket" {
  description = "Allow terraform destroy to delete all uploaded photos."
  type        = bool
  default     = true
}
