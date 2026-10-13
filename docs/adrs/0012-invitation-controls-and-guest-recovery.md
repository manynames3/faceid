# ADR 0012: Add Event Invitation Controls And Guest Submission Recovery

## Status

Accepted in source. Requires a coordinated frontend, Lambda and API Gateway release.

## Context

Guests need to know who is requesting their face photos and how to contact them. Hosts need to stop public intake without deleting an event. A lost processing response must not encourage guests to upload the same references again. Hosts also need useful approved output beyond filenames.

## Decision

- Keep owner-only event settings in the existing DynamoDB event record: event name, host name, contact email, signup state and invitation version.
- Require host/contact details in the invitation UI. Whitelist only invitation metadata on the public read route; no guest list or library is exposed.
- Closing signup blocks new guest presign and processing requests. Reopening increments the HMAC input version, permanently invalidating earlier links for that event. Version-zero tokens remain compatible with existing invitations.
- Use consistent event reads and conditional writes to prevent a concurrent update from restoring a previous invitation version. The settings UI omits an unchanged signup toggle.
- Store only issued upload IDs in tab-scoped browser storage before requesting guest processing. A read-only status route validates the event capability and every session's owner, event, source, mode and person ID before checking saved references. It never repeats matching or indexing.
- Keep the original-download view owner-only (now named Deliver). Serve original downloads with a fresh five-minute S3 attachment URL after authentication and photo ownership checks. Retain CSV export without signed URLs. Separate guest gallery delivery was subsequently added in [ADR 0013](0013-private-approved-guest-galleries.md).

## Consequences

No new services or production dependencies are needed. Guest status checks cost DynamoDB reads, not Rekognition calls. Downloads have normal S3 request/transfer costs. Existing records remain compatible, and demo routes remain completely local.

Invitation links are bearer capabilities, not identity verification, and do not expire automatically. Closing does not cancel processing already authorized or revoke S3 PUT URLs already issued. A stuck request, expired receipt or revoked invitation may require host assistance. Host contact provides a removal-request path, not self-service deletion or a compliance guarantee. Original downloads do not create hosted guest galleries or replace the photographer's delivery service.
