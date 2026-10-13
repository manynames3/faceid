# ADR 0010: Add Event Workspaces, Consent Metadata, And Human Review Decisions

## Status

Accepted

## Context

The first deployed backend treated each authenticated owner as one photo library. That was useful for proving the AWS serverless path, but a production-style event media product needs stronger boundaries: separate events should not mix guests, photos, matches, upload sessions, or S3 prefixes. Because biometric matching is probabilistic, the app also needs a visible human review gate and consent metadata for reference images.

## Decision

Add a DynamoDB `events` table and include `event_id` on people, photos, matches, and upload sessions. Upload keys use `users/<owner>/events/<event>/<mode>/...`, and `/library`, `/uploads/presign`, and `/uploads/process` accept an `eventId`. Reference processing requires workflow-specific consent: owner-attested for host uploads, guest-submitted through the scoped portal in [ADR 0011](0011-event-scoped-guest-intake.md). Named sessions use opaque identifiers rather than merging same-name guests. `matched` and `needs_review` are machine-generated suggestions; both require owner approval before delivery export. Reviewers can approve, reject or correct a decision through `PATCH /matches/{photoId}/{personId}`.

## Consequences

The app now demonstrates SaaS-style workspace isolation and responsible-AI review controls without introducing a full organization/role model. The implementation preserves backward compatibility by mapping older records without `event_id` to a default event. Querying still uses owner indexes plus low-volume event filtering; that keeps Terraform and migration scope small, but a high-volume version should add event-specific GSIs or a single-table access pattern.
