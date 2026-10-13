import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DecisionButtons, Inspector } from "./Inspector";
import { formatScore } from "./format";
import { isUndecided, type ReviewEntry } from "./library";
import type { DecisionStatus } from "./types";
import { EmptyState, PhotoImage, StatusBadge } from "./ui";

type Filter = "pending" | "approved" | "rejected" | "all";
const pageSize = 20;
const filterLabels: Record<Filter, string> = {
  pending: "To review",
  approved: "Approved",
  rejected: "Rejected",
  all: "All",
};

export function ReviewView({
  entries,
  hasPhotos,
  isDemo,
  noMatchPhotoCount,
  onGoToDeliver,
  onGoToPhotos,
  onRefresh,
  onReview,
  reviewingKeys,
}: {
  entries: ReviewEntry[];
  hasPhotos: boolean;
  isDemo: boolean;
  noMatchPhotoCount: number;
  onGoToDeliver: () => void;
  onGoToPhotos: () => void;
  onRefresh: () => void;
  onReview: (entry: ReviewEntry, status: DecisionStatus) => Promise<void> | void;
  reviewingKeys: ReadonlySet<string>;
}) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [selection, setSelection] = useState({ key: "", index: 0 });
  const [inspectorKey, setInspectorKey] = useState<string | null>(null);
  const closeInspector = useCallback(() => setInspectorKey(null), []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => {
    const result = { all: entries.length, approved: 0, pending: 0, rejected: 0 };
    for (const { match } of entries) {
      if (isUndecided(match.status)) result.pending++;
      else if (match.status === "approved") result.approved++;
      else result.rejected++;
    }
    return result;
  }, [entries]);
  const filtered = useMemo(
    () =>
      entries.filter(
        ({ match }) =>
          filter === "all" ||
          (filter === "pending" ? isUndecided(match.status) : match.status === filter),
      ),
    [entries, filter],
  );
  // Keep the same photo on failure; a saved decision advances only when it leaves this filter.
  const selectedIndex = filtered.findIndex((entry) => entry.key === selection.key);
  const index = selectedIndex >= 0 ? selectedIndex : Math.min(selection.index, filtered.length - 1);
  const current = filtered[index];
  const shown = filtered.slice(0, Math.max(visibleCount, index + 1));
  const inspectorItems = useMemo(
    () => filtered.map((entry) => ({ entry, key: entry.key, photo: entry.photo })),
    [filtered],
  );

  useEffect(() => {
    if (!current && document.activeElement === document.body) headingRef.current?.focus();
  }, [current]);

  function select(nextIndex: number) {
    const entry = filtered[nextIndex];
    if (entry) setSelection({ key: entry.key, index: nextIndex });
  }
  function step(direction: -1 | 1) {
    select(index + direction);
    requestAnimationFrame(() => {
      const preferred = direction === 1 ? nextRef.current : previousRef.current;
      const fallback = direction === 1 ? previousRef.current : nextRef.current;
      (preferred?.disabled ? fallback : preferred)?.focus();
    });
  }

  return (
    <div className="view review-view">
      <div className="view-heading">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            Review matches
          </h1>
          <p className="view-subtitle">Only approved matches enter the delivery list.</p>
        </div>
        <div aria-label="Filter by decision" className="segmented" role="group">
          {(Object.keys(filterLabels) as Filter[]).map((key) => (
            <button
              aria-pressed={filter === key}
              className="segment"
              key={key}
              onClick={() => {
                setFilter(key);
                setVisibleCount(pageSize);
                setSelection({ key: "", index: 0 });
              }}
              type="button"
            >
              {filterLabels[key]} <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      {noMatchPhotoCount > 0 && (
        <p className="hint">
          {noMatchPhotoCount} {noMatchPhotoCount === 1 ? "photo has" : "photos have"} no suggested
          guest.{" "}
          <button className="text-button" onClick={onGoToPhotos} type="button">
            View event photos
          </button>
        </p>
      )}

      {entries.length === 0 ? (
        <EmptyState
          action={
            <button className="button button-primary" onClick={onGoToPhotos} type="button">
              {hasPhotos ? "Go to photos" : "Upload event photos"}
            </button>
          }
          title={hasPhotos ? "No matches to review" : "Nothing to review yet"}
        >
          {hasPhotos
            ? "None of the uploaded photos matched a guest."
            : "Suggested matches appear after you upload your event photos."}
        </EmptyState>
      ) : !current ? (
        <EmptyState
          action={
            filter === "pending" && counts.approved > 0 ? (
              <button className="button button-primary" onClick={onGoToDeliver} type="button">
                Open approved photo list
              </button>
            ) : undefined
          }
          title={filter === "pending" ? "You're all caught up" : "No matches in this view"}
        >
          {filter === "pending"
            ? counts.approved > 0
              ? "Every suggested match has a decision. Your approved photo list is ready, and earlier decisions can still be changed."
              : "Every suggested match was rejected. Nothing will be included in delivery. You can still change earlier decisions."
            : "There are no " + filter + " matches yet."}
        </EmptyState>
      ) : (
        <div className="review-desk">
          <aside aria-label="Review queue" className="review-queue">
            <h2>
              {filterLabels[filter]} <span className="muted">{filtered.length}</span>
            </h2>
            <ul>
              {shown.map((entry, itemIndex) => (
                <li key={entry.key}>
                  <button
                    aria-pressed={current.key === entry.key}
                    className="review-queue-item"
                    onClick={() => select(itemIndex)}
                    title={entry.match.personName + " in " + entry.photo.name}
                    type="button"
                  >
                    <PhotoImage alt="" src={entry.photo.previewUrl} />
                    <span>
                      <strong>{entry.match.personName}</strong>
                      <small>{entry.photo.name}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > shown.length && (
              <button
                className="text-button"
                onClick={() => setVisibleCount((count) => count + pageSize)}
                type="button"
              >
                Show more ({filtered.length - shown.length})
              </button>
            )}
          </aside>
          <section
            aria-label={"Review " + current.match.personName + " in " + current.photo.name}
            className="review-comparison"
          >
            <div className="comparison-images">
              <figure className="comparison-event">
                <figcaption>
                  <strong>Event photo</strong>
                  <span title={current.photo.name}>{current.photo.name}</span>
                </figcaption>
                <div className="review-navigation">
                  <div className="mobile-review-picker field">
                    <label className="visually-hidden" htmlFor="review-selection">
                      Selected match
                    </label>
                    <select
                      id="review-selection"
                      onChange={(event) => select(Number(event.target.value))}
                      value={index}
                    >
                      {filtered.map((entry, itemIndex) => (
                        <option key={entry.key} value={itemIndex}>
                          {itemIndex + 1}. {entry.match.personName} · {entry.photo.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="review-position" aria-live="polite">
                    {index + 1} of {filtered.length}
                  </span>
                  <div className="actions">
                    <button
                      aria-label="Previous match"
                      className="button button-icon"
                      disabled={index === 0}
                      onClick={() => step(-1)}
                      ref={previousRef}
                      title="Previous match"
                      type="button"
                    >
                      <ChevronLeft aria-hidden="true" size={19} />
                    </button>
                    <button
                      aria-label="Next match"
                      className="button button-icon"
                      disabled={index >= filtered.length - 1}
                      onClick={() => step(1)}
                      ref={nextRef}
                      title="Next match"
                      type="button"
                    >
                      <ChevronRight aria-hidden="true" size={19} />
                    </button>
                  </div>
                </div>
                <div className="comparison-photo">
                  <PhotoImage
                    alt={"Event photo " + current.photo.name + ", shown without cropping"}
                    eager
                    onReload={onRefresh}
                    src={current.photo.previewUrl}
                  />
                  <button
                    aria-label="Open full-size photo comparison"
                    className="button button-icon expand-photo"
                    onClick={() => setInspectorKey(current.key)}
                    title="Open full size"
                    type="button"
                  >
                    <Expand aria-hidden="true" size={18} />
                  </button>
                </div>
              </figure>
              <div className="comparison-guest">
                <figure>
                  <figcaption>
                    <strong>Guest reference</strong>
                    <span>{current.match.personName}</span>
                  </figcaption>
                  <div className="comparison-reference">
                    {current.person?.referencePreviewUrl ? (
                      <PhotoImage
                        alt={"Reference photo of " + current.match.personName}
                        eager
                        onReload={onRefresh}
                        src={current.person.referencePreviewUrl}
                      />
                    ) : (
                      <div className="image-fallback">No reference preview available</div>
                    )}
                  </div>
                </figure>
                <div className="comparison-result">
                  <p>
                    {isDemo ? "Sample score" : "Matching score"}{" "}
                    <strong>{formatScore(current.match.confidence)}</strong>
                  </p>
                  <StatusBadge status={current.match.status} />
                  <p className="hint">
                    {isDemo
                      ? "Simulated result. No face analysis has run."
                      : "A suggested match, not proof of identity."}
                  </p>
                </div>
              </div>
            </div>
            <div className="review-decision-bar">
              <span className="meta">
                {reviewingKeys.has(current.key)
                  ? "Saving your decision..."
                  : current.match.personName}
              </span>
              <DecisionButtons
                busy={reviewingKeys.has(current.key)}
                entry={current}
                onReview={(entry, status) => void onReview(entry, status)}
              />
            </div>
          </section>
        </div>
      )}
      {inspectorKey && (
        <Inspector
          isDemo={isDemo}
          items={inspectorItems}
          onClose={closeInspector}
          onReloadImages={onRefresh}
          onReview={onReview}
          reviewingKeys={reviewingKeys}
          startKey={inspectorKey}
        />
      )}
    </div>
  );
}
