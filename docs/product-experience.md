# Product Experience Review

Codex and subscription-authenticated Claude Review independently examined baseline `23f39be`. The agreed audience is an event photographer or private-event operator preparing photos for consenting guests. The review found a useful matching pipeline, but not a complete customer workflow. An earlier readiness score should not be treated as evidence that a stranger can use or pay for it unaided.

## Initial Review Priorities

| Gap | User consequence | Decision for this pass |
| --- | --- | --- |
| No output after review | The photographer cannot hand off results | Approved-only CSV and filename copy; no hosted-gallery claim |
| Small, irreversible review controls | Wrong decisions and slow review | Full-image inspector, reference preview, visible states and changeable decisions |
| Filename-only identities and cumulative counts | Guests are mislabeled or counts are wrong | Explicit names bound to upload sessions; identifiers and authoritative snapshots |
| Stale data during event switching | Wrong event data appears under a new name | Clear/loading/error states, guarded callbacks and locked mutations |
| Opaque upload failures and hard limits | Ordinary photo selections fail without explanation | Prevalidation, conservative requests, progress, partial results and qualified retries |
| Unlabeled simulated matches | The demo appears to prove recognition accuracy | Explicit isolated demo and counts derived from sample data |
| Technical sign-in screen | A photographer cannot understand the offer | Public sales homepage and an actual sample-workspace CTA |
| Missing keyboard/mobile states | Guests/operators struggle on smaller screens | Working menus, focus states, native dialogs and reduced motion |

## Design Agreement

Use a text-only photography wordmark, restrained serif landing type, clear local photography, neutral surfaces, graphite text, deep teal commands and compact task navigation. The app centers on Guests, Photos, Review and Deliver. Motion should provide brief feedback; an animation library or 3D scene adds no necessary value to this workflow. Images and names in the sample event are illustrative, not customer evidence.

## What A 10/10 Requires

Visual polish alone cannot complete the product. These acceptance conditions remain for an end-user release:

- A photographer and a guest complete their separate workflows without assistance, including reference intake, review, final delivery, corrections and removal requests.
- Guest removal requests need an operational response and eventually a self-service path. Event/host details, permission capture and a host contact link now exist; email alone does not prove deletion was completed.
- The new guest gallery delivery flow must be exercised on a consenting real event, including link sharing, revocation and original downloads.
- Manual assignment and bounded rematching now exist in source; pilot evidence must establish that they recover missed photos without increasing review mistakes.
- Uploads resume after interruptions, reconcile uncertain outcomes without duplicates, and survive processing limits through durable background jobs.
- Large libraries use thumbnails and pagination, with measured time and cloud-cost bounds for the intended event size.
- Event/account cleanup and retention have working controls, clear policies, ownership and verified outcomes.
- Purchase/support paths work, and a real pilot demonstrates time saved or better delivery compared with the photographer's current process.
- Automated journey checks and a deployed smoke test cover sign-in, event isolation, named references, upload, corrected review and delivery.

## Initial Release Scope And Evidence

Claude Review supplied read-only findings. Claude Code implemented the scoped frontend in an isolated worktree; Codex reviewed and integrated it, added backend support, and corrected consent/form switching, uncertain upload accounting, simulated-score labels, modal focus and mobile image overlap. Claude Motion was evaluated; native CSS feedback was the agreed choice. No new production dependencies were added. A follow-up Claude review stopped at the subscription limit without returning a report; no API-billing fallback was used. No cloud resources, payment integration, hosted gallery service or automated privacy policy are implied by this UI pass.

The initial checkout matched GitHub `main` and lacked the older uncommitted guest portal. During release preparation, Codex recovered its protocol from the active Lambda package and confirmed the public routes in API Gateway. This release restores the guest frontend and preserves existing tokens and issued sessions, rather than overwriting the deployed signup workflow. Guest-side withdrawal and finished-gallery delivery are still missing. The original production Terraform state was not available; this release updates code without replacing resources or the signing secret.

## Invitation And Review Follow-Up

The October 13 end-user readiness pass adds these source-level capabilities without new services or production dependencies:

- A dedicated invitation with event/host identity, contact email, reference previews/removal, specific consent, closed-signup and next-step states. `/demo/guest` previews the flow without uploading anything.
- Owner event settings and per-event signup closure/rotation. Existing links remain compatible until a host closes/reopens intake; concurrent writes cannot restore an old invitation version.
- Receipt-based guest recovery after an uncertain response, including reload recovery, without another processing request.
- A suggested-face outline for new matches and an uncropped mobile comparison with both faces visible together. Old records without boxes still work. Noah's simulated group-photo example is now distinct from his reference.
- An honestly named Approved view with individual original downloads, plus existing CSV and filename export. Hosted galleries and automatic delivery are not implied.
- A product screenshot on the landing page and direct entry points to both sides of the sample experience.

Local verification: 74 frontend and 42 backend tests; lint and production build; Terraform format/validation and diff checks. Terraform reports existing DynamoDB argument-deprecation warnings. Browser checks cover host settings/closure, guest name/photo/consent/success, mobile comparison alignment, approval and an actual sample-photo download. A separate local preview with stubbed API responses verifies lost processing confirmation, a saved receipt across reload, status recovery without repeat processing, and a closed invitation with no upload form. These are not real-AWS end-to-end tests. Sample guest signup made no API calls.

No cloud resources were changed in this pass. Release requires the new API Gateway routes and Lambda before the frontend; preserve existing secrets and recover/import production Terraform state first. Before calling this a paid-ready product, complete a consenting real-event pilot, production smoke test, effective support/deletion process, and a validated end-to-end photo handoff. At that point, background jobs, correction, galleries, retention and billing remained open. The next source-level pass below adds corrections and galleries; production validation is still required.

## Delivery And Correction Follow-Up

The next pass implements private guest galleries, manual assignment and explicit rematching. Gallery links expire in seven days and can be replaced or disabled; each list/download request rechecks current approval and scope. References and other match identities are excluded. Manual matches have an explicit source and no fabricated score. Conditional transactions protect assignments/counters, while replayable bounded rematch requests preserve human decisions. The demo never manufactures additional relationships between unrelated sample portraits.

The landing page and invitation success copy now describe actual private-gallery delivery, and Deliver offers guest links alongside original downloads and exports. Gallery URLs remain only in active workspace memory for repeat copying; after a reload, the host must explicitly replace an existing link rather than retrieve a stored plaintext capability.

Local contract verification used the actual Python API handler behind a localhost HTTP fixture with AWS fakes: an approved original downloaded, rematching replayed without duplicate counts, a new candidate stayed hidden until approval, rejection removed the photo and denied a new download (404), and revocation displayed an unavailable gallery. Public gallery views were inspected at 320, 390, 768 and 1440 pixels. This does not validate Cognito, S3 signatures, actual face recognition, deployed AWS permissions, or business value.

Removal now disables gallery access before multi-service cleanup, leaves a retryable state on failure, and blocks concurrent reference/match writes from restoring a removed guest. Conditional reference updates enforce the intake limit under concurrency; rejected indexed faces and their new S3 object are cleaned up without deleting retained faces. Counter updates cannot recreate deleted records. Focused regressions cover these races.

Local validation: 79 frontend and 60 backend tests, lint and production build. No cloud resources were provisioned and no production dependencies were added. Existing Lambda/IAM permissions support the transaction's Put/Update actions; six additional API Gateway routes are defined in Terraform. Real-event testing, deployed smoke checks, large-library thumbnails/pagination, durable background jobs, billing and support/deletion operations still need work before calling this 10/10.

## Previous Release Verification

Checked locally on October 13, 2026:

- 64 frontend tests and 31 backend tests passed, including explicit demo/API separation, OAuth callback state and single-flight exchange, event-scoped state, named upload sessions, safe delivery export and recovered guest-intake compatibility/security.
- Lint, TypeScript/production build, Terraform formatting and `git diff --check` passed. The dependency audit reported no known vulnerabilities; this is not a complete security assessment.
- Rendered landing and review layouts at 320, 375, 768 and 1440 pixels wide had no horizontal overflow or clipped controls. Local images loaded. The short 320 x 568 landing retained a glimpse of the next section.
- Browser checks covered event creation, an international guest name, required consent, simulated photo upload, event switching and preserved data, intake clearing on guest switches, full-size comparison, keyboard navigation, Escape/focus return, corrected review decisions, approved-only partial CSV download and the no-approved empty state.
- The actual downloaded CSV contained the approved guest/photo row and no preview links. Pending/rejected results were excluded; zero approvals disabled export.
- Missing live configuration displayed an unavailable screen with a working sample-workspace alternative. Production deployment and read-only API boundary checks are performed separately for release. The full AWS sign-in/photo-upload journey, recognition accuracy and cloud cost under load are not covered by the local checks.
- Browser re-verification after restoring guest signup was blocked by the executor rejecting a symlinked writable root. The guest page has API contract coverage, backend authorization/legacy-session tests and a successful production build; no fresh rendered guest-page result is claimed.

## Honest Demo Script

1. Open the homepage: "This helps a photographer find consenting guests in a private shoot, check the matches, and send each guest a private gallery."
2. Open the sample workspace: "These photos, names and scores are examples. Nothing is analysed or sent to AWS here."
3. In Guests, open **Preview guest signup**: enter a name, choose a photo, confirm permission and submit. Nothing leaves the browser. In a live event, add host/contact details and use its invitation link; signup can be closed afterward. Withdrawal currently requires contacting the host.
4. In Review, open a photo full size alongside its reference. Approve one result and reject another; then change a decision to demonstrate correction.
5. In Photos, show the manual correction dialog and its confirmation gate. Open Find in photos and show that earlier decisions are excluded. In Deliver, preview the approved-only guest gallery and download an original. In a live event, create/copy a seven-day link and show the disable control. The host sends the link directly; no automatic email is promised.
6. For a technical audience, show the architecture/ADRs and named-session tests. For a photographer, close with the remaining pilot question: does this reduce their sorting and handoff time on a real consenting event?
