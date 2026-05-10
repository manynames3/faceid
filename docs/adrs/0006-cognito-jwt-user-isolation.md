# ADR 0006: Use Cognito JWTs For API Auth And User Isolation

## Status

Accepted

## Context

The initial backend was useful as a low-volume prototype, but public presign and processing routes did not prove a credible production trust boundary. The app needs a lightweight way to authenticate browser users and keep each user's photos, people, and matches separate.

## Decision

Use Cognito Hosted UI with Authorization Code + PKCE for frontend sign-in. Protect API Gateway routes with a Cognito JWT authorizer. Use the Cognito `sub` claim as the owner identifier for S3 key prefixes and DynamoDB records.

## Consequences

- Public callers can no longer request upload URLs or process photos without a valid token.
- S3 keys and DynamoDB records are scoped to the authenticated user.
- The frontend needs Cognito environment variables in addition to the API base URL.
- The current implementation keeps token handling simple and does not include silent refresh, user administration, or retention workflows.
