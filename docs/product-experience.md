# Product Experience Review

Codex and subscription-authenticated Claude Review independently examined baseline `23f39be`. The agreed audience is an event photographer or private-event operator preparing photos for consenting guests. The review found a useful matching pipeline, but not a complete customer workflow. An earlier readiness score should not be treated as evidence that a stranger can use or pay for it unaided.

## Agreed Priorities

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
- Public guest intake identifies the event and operator, captures specific permission, and offers an effective withdrawal/removal path.
- Approved photos reach guests through a usable delivery destination; a CSV alone is not a complete guest experience.
- The photographer can assign a missed guest to a photo and reprocess existing photos after adding better references; they can recover useful photos below the matching threshold.
- Uploads resume after interruptions, reconcile uncertain outcomes without duplicates, and survive processing limits through durable background jobs.
- Large libraries use thumbnails and pagination, with measured time and cloud-cost bounds for the intended event size.
- Event/account cleanup and retention have working controls, clear policies, ownership and verified outcomes.
- Purchase/support paths work, and a real pilot demonstrates time saved or better delivery compared with the photographer's current process.
- Automated journey checks and a deployed smoke test cover sign-in, event isolation, named references, upload, corrected review and delivery.

## Scope And Evidence

Claude Review supplied read-only findings. Claude Code implemented the scoped frontend in an isolated worktree; Codex reviewed and integrated it, added backend support, and corrected consent/form switching, uncertain upload accounting, simulated-score labels, modal focus and mobile image overlap. Claude Motion was evaluated; native CSS feedback was the agreed choice. No new production dependencies were added. A follow-up Claude review stopped at the subscription limit without returning a report; no API-billing fallback was used. No cloud resources, payment integration, hosted gallery service or automated privacy policy are implied by this UI pass.

The initial checkout matched GitHub `main` and lacked the older uncommitted guest portal. During release preparation, Codex recovered its protocol from the active Lambda package and confirmed the public routes in API Gateway. This release restores the guest frontend and preserves existing tokens and issued sessions, rather than overwriting the deployed signup workflow. Guest-side withdrawal and finished-gallery delivery are still missing. The original production Terraform state was not available; this release updates code without replacing resources or the signing secret.

## Verification

Checked locally on October 13, 2026:

- 64 frontend tests and 31 backend tests passed, including explicit demo/API separation, OAuth callback state and single-flight exchange, event-scoped state, named upload sessions, safe delivery export and recovered guest-intake compatibility/security.
- Lint, TypeScript/production build, Terraform formatting and `git diff --check` passed. The dependency audit reported no known vulnerabilities; this is not a complete security assessment.
- Rendered landing and review layouts at 320, 375, 768 and 1440 pixels wide had no horizontal overflow or clipped controls. Local images loaded. The short 320 x 568 landing retained a glimpse of the next section.
- Browser checks covered event creation, an international guest name, required consent, simulated photo upload, event switching and preserved data, intake clearing on guest switches, full-size comparison, keyboard navigation, Escape/focus return, corrected review decisions, approved-only partial CSV download and the no-approved empty state.
- The actual downloaded CSV contained the approved guest/photo row and no preview links. Pending/rejected results were excluded; zero approvals disabled export.
- Missing live configuration displayed an unavailable screen with a working sample-workspace alternative. Production deployment and read-only API boundary checks are performed separately for release. The full AWS sign-in/photo-upload journey, recognition accuracy and cloud cost under load are not covered by the local checks.
- Browser re-verification after restoring guest signup was blocked by the executor rejecting a symlinked writable root. The guest page has API contract coverage, backend authorization/legacy-session tests and a successful production build; no fresh rendered guest-page result is claimed.

## Honest Demo Script

1. Open the homepage: "This helps a photographer sort a private shoot into guest-by-guest photo lists. It doesn't replace their gallery host."
2. Open the sample workspace: "These photos, names and scores are examples. Nothing is analysed or sent to AWS here."
3. In Guests, show the invitation and manual-reference options. In a live event, get the signup link and open it separately: guests submit a name, references and permission without an account. The sample workspace does not issue live signup links. Withdrawal currently requires contacting the host.
4. In Review, open a photo full size alongside its reference. Approve one result and reject another; then change a decision to demonstrate correction.
5. In Deliver, export the approved-only list. Show the partial warning while decisions remain, and explain that filenames feed the existing delivery process.
6. For a technical audience, show the architecture/ADRs and named-session tests. For a photographer, close with the remaining pilot question: does this reduce their sorting and handoff time on a real consenting event?
