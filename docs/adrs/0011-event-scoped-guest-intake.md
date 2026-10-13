# ADR 0011: Separate Guest Intake From The Owner Library

## Status

Accepted

## Context

Invited guests need to submit references and permission without creating an account. The existing deployment already supported event signup links, but that implementation had not been committed to GitHub. A source-only release must not remove working guest links or weaken the owner's private library boundaries.

## Decision

Preserve the existing event-scoped HMAC link format and server signing secret. Only an authenticated owner can obtain a link. The three public guest routes validate that capability, return event name/ID only, and accept reference signup, not event-photo processing or library reads. New upload sessions bind the guest name and an opaque identifier; the public workflow records `guest_submitted` consent separately from owner-attested uploads. Keep support for previously issued guest sessions. Terraform models the existing routes and generates a sensitive signing secret for new stacks; imported deployments must retain their existing secret.

## Consequences

Guest signup stays simple, and old links keep working. Holding a link is not proof of identity: guests self-report names and permission, and hosts review matches. Links currently have no automatic expiry or individual revocation, so they must be shared only with invited guests. Rotating the signing secret invalidates all links. Guest-side withdrawal and secure finished-gallery delivery remain separate work; this portal does not expose event photos. Terraform state contains the signing secret and must not be committed.
