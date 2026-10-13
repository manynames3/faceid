import { useCallback, useMemo, useRef, useState } from "react";
import { DecisionButtons, Inspector } from "./Inspector";
import { formatScore } from "./format";
import { initialsFromName } from "./simulate";
import { isUndecided, type ReviewEntry } from "./library";
import type { DecisionStatus } from "./types";
import { Avatar, EmptyState, PhotoImage, StatusBadge } from "./ui";

type Filter = "pending" | "approved" | "rejected" | "all";

const pageSize = 20;

const filterLabels: Record<Filter, string> = {
  all: "All",
  approved: "Approved",
  pending: "Needs decision",
  rejected: "Rejected",
};

function matchesFilter(entry: ReviewEntry, filter: Filter) {
  switch (filter) {
    case "pending":
      return isUndecided(entry.match.status);
    case "approved":
      return entry.match.status === "approved";
    case "rejected":
      return entry.match.status === "rejected";
    default:
      return true;
  }
}

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
  const [inspectorKey, setInspectorKey] = useState<string | null>(null);
  const closeInspector = useCallback(() => setInspectorKey(null), []);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: entries.length, approved: 0, pending: 0, rejected: 0 };
    for (const entry of entries) {
      if (entry.match.status === "approved") {
        result.approved += 1;
      } else if (entry.match.status === "rejected") {
        result.rejected += 1;
      } else {
        result.pending += 1;
      }
    }
    return result;
  }, [entries]);

  const filtered = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );
  const inspectorItems = useMemo(
    () => filtered.map((entry) => ({ entry, key: entry.key, photo: entry.photo })),
    [filtered],
  );
  const shown = filtered.slice(0, visibleCount);

  // A decided row can leave the list; keep keyboard focus nearby instead of losing it.
  async function handleReview(entry: ReviewEntry, status: DecisionStatus) {
    const index = shown.findIndex((item) => item.key === entry.key);
    const neighbour = shown[index + 1] ?? shown[index - 1];
    await onReview(entry, status);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) {
        return;
      }
      const row = neighbour
        ? Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? []).find(
            (element) => element.dataset.key === neighbour.key,
          )
        : undefined;
      (row?.querySelector<HTMLElement>("button.button-decision") ?? headingRef.current)?.focus();
    });
  }

  return (
    <div className="view review-view">
      <div className="section-head">
        <h2 className="section-title" ref={headingRef} tabIndex={-1}>
          Review matches
        </h2>
        <div aria-label="Filter by decision" className="segmented" role="group">
          {(Object.keys(filterLabels) as Filter[]).map((key) => (
            <button
              aria-pressed={filter === key}
              className="segment"
              key={key}
              onClick={() => {
                setFilter(key);
                setVisibleCount(pageSize);
              }}
              type="button"
            >
              {filterLabels[key]} <span className="muted">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="hint">
        Only approved matches reach your delivery list. {isDemo
          ? "These sample scores are simulated; no face analysis has run."
          : "Matching scores are estimates, not identity proof."}
      </p>
      {noMatchPhotoCount > 0 && (
        <p className="hint">
          {noMatchPhotoCount} {noMatchPhotoCount === 1 ? "photo" : "photos"} matched no guest and
          won't appear here. Find them under "No guest matched" on the Photos tab.
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
            : "Suggested matches show up here after you upload event photos."}
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          action={
            filter === "pending" && counts.approved > 0 ? (
              <button className="button button-primary" onClick={onGoToDeliver} type="button">
                Go to Deliver
              </button>
            ) : undefined
          }
          title={filter === "pending" ? "Every match has a decision" : "Nothing here"}
        >
          {filter === "pending"
            ? "No suggested matches are waiting. You can change an earlier decision from the Approved or Rejected filters."
            : "No matches have this decision."}
        </EmptyState>
      ) : (
        <>
          <ul className="review-list" ref={listRef}>
            {shown.map((entry) => {
              const person = entry.person ?? {
                initials: initialsFromName(entry.match.personName),
                name: entry.match.personName,
                referencePreviewUrl: undefined,
              };
              return (
                <li className="review-row" data-key={entry.key} key={entry.key}>
                  <button
                    aria-label={`View ${entry.photo.name} full size, suggested for ${entry.match.personName}`}
                    className="review-thumb"
                    onClick={() => setInspectorKey(entry.key)}
                    type="button"
                  >
                    <PhotoImage
                      alt={`Event photo ${entry.photo.name}`}
                      className="review-thumb-image"
                      src={entry.photo.previewUrl}
                    />
                  </button>
                  <div className="review-who">
                    <Avatar person={person} />
                    <div className="review-main">
                      <h3 className="truncate">{entry.match.personName}</h3>
                      <p className="meta">
                        Matching score {formatScore(entry.match.confidence)}
                      </p>
                      <p className="meta truncate" title={entry.photo.name}>
                        {entry.photo.name}
                      </p>
                      <StatusBadge status={entry.match.status} />
                    </div>
                  </div>
                  <DecisionButtons
                    busy={reviewingKeys.has(entry.key)}
                    entry={entry}
                    onReview={(item, status) => void handleReview(item, status)}
                  />
                </li>
              );
            })}
          </ul>
          {filtered.length > shown.length && (
            <div className="show-more">
              <button
                className="button"
                onClick={() => setVisibleCount((count) => count + pageSize)}
                type="button"
              >
                Show more ({filtered.length - shown.length} left)
              </button>
            </div>
          )}
        </>
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
