# ADR 0007: Verify Upload Sessions Before Processing S3 Objects

## Status

Accepted

## Context

Presigned S3 uploads avoid proxying image bytes through Lambda, but the processing API should not trust arbitrary client-provided S3 keys. The backend needs to prove that a requested object was issued by the API, belongs to the authenticated user, and matches the expected metadata before sending it to Rekognition.

## Decision

Create one DynamoDB upload session per presigned file. Return the upload session ID to the frontend, require it in `/uploads/process`, sign the S3 PUT with an `x-amz-meta-upload-id` header, and verify the DynamoDB session plus S3 `HeadObject` metadata before processing.

## Consequences

- Callers cannot process arbitrary user-prefixed S3 keys without a valid issued upload session.
- Object size, content type, owner scope, key, and upload metadata are checked before Rekognition runs.
- Each upload adds a small DynamoDB write/read/update cost.
- Failed processing after a session is claimed may require the user to upload the file again.
