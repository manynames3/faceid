# ADR 0009: Add Owner-Scoped Delete Workflows

## Status

Accepted

## Context

The application stores uploaded photos, reference images, Rekognition face IDs, and match metadata across S3, Rekognition, and DynamoDB. Because this data is persistent, users need a way to remove their own data without granting broad administrative access or exposing one user's records to another.

## Decision

Add authenticated `DELETE /photos/{photoId}` and `DELETE /people/{personId}` routes behind the same Cognito JWT authorizer as the upload and library endpoints. Lambda verifies the owner before deleting records, then removes related S3 objects, DynamoDB metadata, match rows, and Rekognition face IDs where applicable.

Uploaded event photos are deleted individually. Reference images remain grouped under the person record in the current data model, so deleting a person removes that person's reference images and related matches.

## Consequences

Users can clean up persisted photo and reference data from the app without manual AWS access. The implementation keeps the IAM and API surface small, but cross-service deletes are not transactional; a retry or repair workflow would be needed for stricter production guarantees.
