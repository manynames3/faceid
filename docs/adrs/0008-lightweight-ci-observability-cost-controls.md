# ADR 0008: Add Lightweight CI, Observability, And Cost Controls

## Status

Accepted

## Context

The project should read as production-style work without adding a large platform footprint. Reviewers need evidence that changes are tested, infrastructure is validated, runtime failures are visible, and cost risk is bounded.

## Decision

Use GitHub Actions for linting, tests, frontend build, Lambda syntax checks, and Terraform validation. Emit structured Lambda logs, enable API Gateway access logs, create CloudWatch alarms for Lambda errors, Lambda throttles, and API 5xx responses, and support an optional AWS Budget email alert.

## Consequences

- Pull requests and pushes get repeatable quality gates.
- Runtime failures and API errors are easier to inspect in CloudWatch.
- Optional email notifications and budget alerts improve cost and operations awareness.
- Deployment remains manual for now, so CI validates changes but does not promote them automatically.
