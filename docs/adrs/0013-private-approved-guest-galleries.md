# ADR 0013: Deliver Approved Photos Through Private Guest Galleries

## Status

Accepted in source; deploy the new backend routes and frontend together.

## Context

Filename lists leave the photographer with another manual assembly job. Guests need a simple way to view and download their approved photos without an account. Publishing the owner library or a permanent public S3 URL would expose unrelated data.

## Decision

- Use the existing person record to store a random 256-bit capability's guest-bound hash, enabled state, expiry and first-photo hint. Links last seven days. Creating a replacement invalidates the previous capability; disabling or deleting the guest stops future access.
- Keep creation/disablement owner-authenticated. The public gallery returns only event/host/contact/guest details and approved photo IDs, filenames and signed previews. It omits references, other match identities, scores and the guest list.
- Query the existing person-match index, then consistently reread each match/photo to verify approval and owner/event scope. Verify a just-approved photo hint directly so index propagation does not prevent immediate sharing; the hint never bypasses authorization.
- Recheck every original-download request before issuing a five-minute attachment URL. Send links through the host's existing email or messaging tools.
- Keep raw gallery URLs only in the active workspace's memory for repeat copying. After reload, a host explicitly creates a replacement; the database never stores a plaintext capability.

## Consequences

No new storage service, table or dependency is needed. Requests incur normal DynamoDB reads and S3 requests/transfer. The gallery contains whole event photos, which can include other people; the UI states this plainly.

Links are bearer access, not guest identity verification. Revocation cannot recall downloaded copies, and signed image URLs already issued may work for five minutes. Galleries use originals and still need thumbnails/pagination for large shoots. Sharing, removal/support requests and notification remain host-operated; there is no automatic delivery email or self-service biometric deletion.
