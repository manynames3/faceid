# ADR 0002: Use Presigned S3 Uploads

## Status

Accepted

## Context

Image uploads can exceed comfortable API payload limits, and the backend should avoid proxying image bytes through Lambda.

## Decision

Have the frontend request presigned S3 PUT URLs, upload images directly to the private S3 bucket, then call the API with uploaded object keys for processing.

## Consequences

- Lambda handles metadata and orchestration instead of large file bodies.
- S3 remains private while still allowing browser uploads.
- CORS must be configured for both API Gateway and S3.
