# ADR 0003: Use AWS Serverless Services For The Backend

## Status

Accepted

## Context

The backend needs photo storage, face recognition, metadata persistence, and HTTP endpoints without requiring long-running servers.

## Decision

Use API Gateway HTTP API, Cognito JWT authorization, Python Lambda, private S3, DynamoDB, Rekognition, and CloudWatch Logs.

## Consequences

- Idle cost stays low for prototype and low-volume usage.
- Operational work is limited compared with running servers or Kubernetes.
- Runtime behavior depends on AWS service limits and regional availability.
