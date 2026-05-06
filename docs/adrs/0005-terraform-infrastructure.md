# ADR 0005: Manage Backend Infrastructure With Terraform

## Status

Accepted

## Context

The AWS backend includes several connected resources and should be easy to deploy, inspect, and destroy.

## Decision

Define the backend in Terraform under `infra/terraform`, including IAM permissions, API routes, S3 controls, DynamoDB tables, Rekognition collection, and cost guardrails.

## Consequences

- The backend can be recreated consistently from source control.
- Reviewers can inspect infrastructure choices without opening the AWS console.
- Terraform state must be managed carefully if the project moves beyond local/prototype use.
