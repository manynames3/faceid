# ADR 0014: Support Manual Corrections And Bounded Rematching

## Status

Accepted in source; coordinated API/frontend release required.

## Context

Face matching can miss a guest. New guests and better references can arrive after event photos have been uploaded. Requiring photo re-upload wastes time/storage, and repeating a full event's comparisons can be costly or time out.

## Decision

- Let the owner explicitly assign a consenting guest to an existing photo after comparing its image and reference. Record an approved match with manual provenance and no fabricated confidence score.
- Write the match and its counters in one conditional DynamoDB transaction. Owner/consent checks prevent deleted or changed records from leaving half an assignment; competing review changes cause a conflict instead of silently overwriting a decision.
- Rematch only one guest/photo pair per request, using that guest's capped references. Preserve approved/rejected decisions; automatic results remain candidates for human review.
- Bind a request ID to owner/event/photo/guest in a TTL-backed operation record in the existing uploads table. Replay completed requests without repeating recognition; return 409 for pending operations.
- Let the browser check up to 50 selected photos sequentially with progress and per-photo results. Reuse an uncertain request ID when checking a failed response. Definitively failed attempts get a new ID.
- Keep manual provenance visible in the UI and CSV, with blank similarity for manually assigned rows. Legacy scored records default to face-match provenance.

## Consequences

Rematching performs at most the selected-photo count times the per-guest reference cap in comparisons, rather than comparing every guest again. No worker service or production dependency is added. Transaction actions use the existing Put/Update permissions; see [AWS transaction IAM guidance](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).

This is bounded synchronous work, not a durable background job. Closing/reloading the search loses local progress, while completed records remain saved. Starting a new search can incur new comparisons. A stuck operation or service failure still needs reconciliation/support. Existing references remain capped at two; manual assignment recovers missed photos without claiming recognition accuracy.
