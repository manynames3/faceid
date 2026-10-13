import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatDate, formatScore } from "./format";
import type { InspectorItem, ReviewEntry } from "./library";
import type { DecisionStatus } from "./types";
import { PhotoImage, StatusBadge } from "./ui";
import { MatchedPhoto } from "./MatchedPhoto";
import { useModalDialog } from "./useModalDialog";

type ReviewHandler = (entry: ReviewEntry, status: DecisionStatus) => void;

/**
 * Approve/Reject for a match. Undecided matches get both; decided ones can be
 * changed to the opposite outcome (there is no "back to pending" in the API).
 */
export function DecisionButtons({
  busy,
  entry,
  onReview,
}: {
  busy: boolean;
  entry: ReviewEntry;
  onReview: ReviewHandler;
}) {
  const { match, photo } = entry;
  const target = `${match.personName} in ${photo.name}`;

  if (match.status === "approved") {
    return (
      <div className="decision-buttons">
        <button
          aria-label={`Change to rejected: ${target}`}
          className="button button-decision"
          disabled={busy}
          onClick={() => onReview(entry, "rejected")}
          type="button"
        >
          <X aria-hidden="true" size={18} />
          Change to rejected
        </button>
      </div>
    );
  }

  if (match.status === "rejected") {
    return (
      <div className="decision-buttons">
        <button
          aria-label={`Change to approved: ${target}`}
          className="button button-decision"
          disabled={busy}
          onClick={() => onReview(entry, "approved")}
          type="button"
        >
          <Check aria-hidden="true" size={18} />
          Change to approved
        </button>
      </div>
    );
  }

  return (
    <div className="decision-buttons">
      <button
        aria-label={`Reject ${target}`}
        className="button button-decision button-reject"
        disabled={busy}
        onClick={() => onReview(entry, "rejected")}
        type="button"
      >
        <X aria-hidden="true" size={18} />
        Not this guest
      </button>
      <button
        aria-label={`Approve ${target}`}
        className="button button-decision button-approve"
        disabled={busy}
        onClick={() => onReview(entry, "approved")}
        type="button"
      >
        <Check aria-hidden="true" size={18} />
        Approve match
      </button>
    </div>
  );
}

/**
 * Full-size photo viewer in a native modal <dialog>: the image is never
 * cropped, arrows and the buttons move between items, Escape closes it, and
 * the browser traps focus while it is open. The list is live, so a decision
 * that removes the current item (e.g. from "needs decision") lands on the next one.
 */
export function Inspector({
  isDemo,
  items,
  onClose,
  onReloadImages,
  onReview,
  reviewingKeys,
  startKey,
}: {
  isDemo: boolean;
  items: InspectorItem[];
  onClose: () => void;
  onReloadImages: () => void;
  onReview: ReviewHandler;
  reviewingKeys: ReadonlySet<string>;
  startKey: string;
}) {
  const ref = useModalDialog();
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const [requestedIndex, setRequestedIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.key === startKey),
    ),
  );

  useEffect(() => {
    if (items.length === 0) {
      onClose();
    }
  }, [items.length, onClose]);

  const index = Math.min(requestedIndex, items.length - 1);
  const item = items[index];
  if (!item) {
    return null;
  }

  const { entry, photo } = item;
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  function step(direction: -1 | 1) {
    const fromNavigation =
      document.activeElement === previousButtonRef.current ||
      document.activeElement === nextButtonRef.current;
    setRequestedIndex(Math.min(Math.max(index + direction, 0), items.length - 1));
    if (fromNavigation) {
      requestAnimationFrame(() => {
        const preferred = direction === 1 ? nextButtonRef.current : previousButtonRef.current;
        const fallback = direction === 1 ? previousButtonRef.current : nextButtonRef.current;
        (preferred?.disabled ? fallback : preferred)?.focus();
      });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key === "ArrowLeft" && hasPrevious) {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight" && hasNext) {
      event.preventDefault();
      step(1);
    }
  }

  const imageAlt = entry
    ? `Event photo ${photo.name}, shown in full. Suggested match: ${entry.match.personName}.`
    : `Event photo ${photo.name}, shown in full. No guest matched.`;

  return (
    <dialog
      aria-labelledby="inspector-title"
      className="dialog inspector"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      ref={ref}
    >
      <header className="inspector-header">
        <h2 className="truncate" id="inspector-title">
          {photo.name}
        </h2>
        <span aria-live="polite" className="muted">
          {index + 1} of {items.length}
        </span>
        <button
          aria-label="Close photo viewer"
          className="button button-icon"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </header>

      <div className="inspector-body">
        <div className="inspector-photo">
          <MatchedPhoto
            alt={imageAlt}
            faceBox={entry?.match.faceBox}
            key={item.key}
            onReload={onReloadImages}
            src={photo.previewUrl}
          />
        </div>

        <div className="inspector-side">
          {entry ? (
            <>
              <h3 className="truncate">{entry.match.personName}</h3>
              <dl className="facts">
                <div>
                  <dt>{entry.match.source === "manual" ? "Added by" : isDemo ? "Sample score" : "Matching score"}</dt>
                  <dd>{entry.match.source === "manual" ? "You" : formatScore(entry.match.confidence)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={entry.match.status} />
                  </dd>
                </div>
                {entry.match.reviewedAt && formatDate(entry.match.reviewedAt) && (
                  <div>
                    <dt>Decided</dt>
                    <dd>{formatDate(entry.match.reviewedAt)}</dd>
                  </div>
                )}
              </dl>
              <p className="hint">
                {entry.match.source === "manual" ? "You confirmed this guest is in the photo. No face-matching score was recorded." : isDemo
                  ? "This is a simulated result. No face analysis has been run."
                  : "The score comes from the face matcher. It is an estimate, not certainty, so compare the faces yourself before approving."}
              </p>

              <div className="reference-compare">
                <p className="label">Reference photo</p>
                {entry.person?.referencePreviewUrl ? (
                  <PhotoImage
                    alt={`Reference photo of ${entry.match.personName}`}
                    className="reference-image"
                    eager
                    key={entry.person.referencePreviewUrl}
                    src={entry.person.referencePreviewUrl}
                  />
                ) : (
                  <p className="muted">No reference preview is available for this guest.</p>
                )}
              </div>

              <DecisionButtons
                busy={reviewingKeys.has(entry.key)}
                entry={entry}
                onReview={onReview}
              />
            </>
          ) : (
            <>
              <h3>No guest matched</h3>
              <p className="hint">
                None of your guests scored high enough on this photo, so it won't appear in anyone's
                list. If someone is in it, their reference photos may not be clear enough.
              </p>
            </>
          )}

          <div className="inspector-nav">
            <button
              className="button"
              disabled={!hasPrevious}
              onClick={() => step(-1)}
              ref={previousButtonRef}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={18} />
              Previous
            </button>
            <button
              className="button"
              disabled={!hasNext}
              onClick={() => step(1)}
              ref={nextButtonRef}
              type="button"
            >
              Next
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
