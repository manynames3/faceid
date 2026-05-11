# Responsible Use And Matching Quality

FaceID Events is designed for private event photo delivery: an owner creates an event workspace, confirms guest consent for reference uploads, uploads named guest reference images and event photos, then reviews matches before using the per-person galleries. It is not designed for public surveillance, law-enforcement identification, or automated decisions that affect a person's rights, liberty, discipline, employment, access, or safety.

## Reference Image Guidance

Face matching is probabilistic. Angle, lighting, blur, image quality, and occlusion can change match confidence. Use more reference images when the event photos are likely to include side angles, candid expressions, low light, hats, glasses, or group shots.

Recommended reference set per guest:

- 1 front-facing image with clear lighting.
- 1 slight left or right angle.
- 1 candid or event-like photo when available.
- Optional extra reference when the person often wears glasses, hats, or other face-adjacent accessories.

The backend currently compares a bounded number of references per person through `MAX_REFS_PER_PERSON`. The default is intentionally low for cost control. For use cases where different angles matter, raise that value to `3` or `4`, then validate the impact on both match quality and Rekognition cost.

## Review Queue Expectations

The app separates high-confidence `matched` suggestions from lower-confidence `needs_review` suggestions. Event owners can mark match candidates `approved` or `rejected`; the review queue is part of the product model, not an error state. Event owners should inspect review matches before delivering galleries, especially when:

- Reference photos are old or low quality.
- Event photos include side profiles or partial faces.
- Guests have similar facial features.
- Lighting or motion blur is poor.
- A match would be used outside personal photo organization.

## High-Risk Or Non-Target Use Cases

Correctional, prison, detention, public-safety, or workplace-monitoring surveillance is not a target use case for this project.

Example: booking multiple face angles for an inmate, then tracking locations where that person appears over time.

That is materially different from private event photo delivery. It would be continuous or repeated surveillance in a coercive setting, and false positives or false negatives could affect liberty, discipline, safety, or official records. It would also require a much stronger governance model than this repo provides.

If a government or regulated institution evaluated facial recognition for that context, it would need controls outside this project, including:

- Clear legal authority and policy approval before collection or search.
- Independent accuracy, demographic performance, and image-quality validation.
- Human review before any operational decision.
- Audit logs for every search, reviewer, access, and data change.
- Strict retention, deletion, and access-control policies.
- Appeals, redress, and incident-review processes.
- Procurement, civil-rights, privacy, and security review.

This repository should not be marketed as prison surveillance, inmate tracking, public-space tracking, or automated person-location intelligence.

## References

- AWS notes that `CompareFaces` is probabilistic and recommends comparing against multiple source images to reduce false negatives: <https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html>
- NIST's face recognition evaluation materials document demographic effects and note that false negatives are strongly affected by image quality and pitch-angle variation: <https://pages.nist.gov/frvt/html/frvt_demographics.html>
- The FTC has warned that biometric technologies can create consumer harms and evaluates practices around biometric collection, claims, retention, and use: <https://www.ftc.gov/legal-library/browse/policy-statement-federal-trade-commission-biometric-information-section-5-federal-trade-commission>
