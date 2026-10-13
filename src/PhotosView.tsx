import { AlertTriangle, CheckCircle2, CircleDashed, Clock, ImagePlus, Trash2, UserRoundPlus, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { Inspector } from "./Inspector";
import { AssignGuest } from "./AssignGuest";
import { formatScore, pluralize } from "./format";
import { buildInspectorItems, type ReviewEntry } from "./library";
import type { DecisionStatus, Person, PhotoAsset } from "./types";
import { ACCEPT_ATTRIBUTE, formatBytes, isRetryableUpload, MAX_UPLOAD_BYTES } from "./uploads";
import type { RejectedFile } from "./uploads";
import type { QueueItem } from "./useWorkspace";
import { ConfirmDialog, Dialog, EmptyState, PhotoImage, Spinner, StatusBadge } from "./ui";

const pageSize = 24;
const noMatchFilter = "__none__";

function queueIcon(status: QueueItem["status"]) {
  switch (status) {
    case "done":
      return <CheckCircle2 aria-hidden="true" size={16} />;
    case "failed":
    case "skipped":
      return <AlertTriangle aria-hidden="true" size={16} />;
    case "uncertain":
      return <Clock aria-hidden="true" size={16} />;
    case "sending":
      return <Spinner />;
    default:
      return <CircleDashed aria-hidden="true" size={16} />;
  }
}

const queueStatusText: Record<QueueItem["status"], string> = {
  done: "Done",
  failed: "Failed",
  queued: "Waiting",
  sending: "Uploading and matching",
  skipped: "Not sent",
  uncertain: "Not confirmed",
};

export function PhotosView({
  isBusy,
  isDemo,
  onDeletePhoto,
  onDismissQueue,
  onDismissRejected,
  onGoToGuests,
  onRefresh,
  onRetry,
  onReview,
  onUpload,
  onAssignGuest,
  onFindGuest,
  submissionError,
  people,
  photos,
  queue,
  rejected,
  reviewingKeys,
}: {
  isBusy: boolean;
  isDemo: boolean;
  onDeletePhoto: (photo: PhotoAsset) => void;
  onDismissQueue: () => void;
  onDismissRejected: () => void;
  onGoToGuests: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onReview: (entry: ReviewEntry, status: DecisionStatus) => void;
  onUpload: (files: File[]) => void;
  onAssignGuest: (photoId: string, personId: string) => Promise<boolean>;
  onFindGuest: () => void;
  submissionError?: string;
  people: Person[];
  photos: PhotoAsset[];
  queue: QueueItem[];
  rejected: RejectedFile[];
  reviewingKeys: ReadonlySet<string>;
}) {
  const [guestFilter, setGuestFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectorKey, setInspectorKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PhotoAsset | null>(null);
  const [assigning, setAssigning] = useState<PhotoAsset | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeInspector = useCallback(() => setInspectorKey(null), []);

  const hasGuests = people.length > 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return photos.filter((photo) => {
      if (guestFilter === noMatchFilter && photo.matches.length > 0) {
        return false;
      }
      if (
        guestFilter !== "all" &&
        guestFilter !== noMatchFilter &&
        !photo.matches.some(
          (match) => match.personId === guestFilter && match.status !== "rejected",
        )
      ) {
        return false;
      }
      return (
        !needle ||
        photo.name.toLowerCase().includes(needle) ||
        photo.matches.some((match) => match.personName.toLowerCase().includes(needle))
      );
    });
  }, [guestFilter, photos, query]);

  const inspectorItems = useMemo(() => buildInspectorItems(filtered, people), [filtered, people]);
  const shown = filtered.slice(0, visibleCount);

  function pick(list: FileList | null) {
    if (list && list.length > 0) {
      onUpload(Array.from(list));
      setUploadOpen(false);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    if (hasGuests && !isBusy) {
      onUpload(Array.from(event.dataTransfer.files));
      setUploadOpen(false);
    }
  }

  const doneCount = queue.filter((item) => item.status === "done").length;
  const retryable = queue.filter((item) => isRetryableUpload(item.status));
  const hasUncertain = queue.some((item) => item.status === "uncertain");
  const isUploading = queue.some((item) => item.status === "sending" || item.status === "queued");

  return (
    <div className="view photos-view">
      <div className="view-heading">
        <div>
          <h1>Event photos</h1>
          <p className="view-subtitle">{pluralize(photos.length, "photo")} in this event</p>
        </div>
        <button
          className="button button-primary"
          disabled={isBusy}
          onClick={() => (hasGuests ? setUploadOpen(true) : onGoToGuests())}
          type="button"
        >
          <ImagePlus aria-hidden="true" size={18} />{" "}
          {hasGuests ? "Upload photos" : "Add a guest first"}
        </button>
      </div>
      {uploadOpen && (
        <Dialog
          onClose={() => {
            setUploadOpen(false);
            setIsDragging(false);
          }}
          title="Upload event photos"
        >
          {hasGuests ? (
            <div
              className={isDragging ? "dropzone dropzone-active" : "dropzone"}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setIsDragging(false);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <ImagePlus aria-hidden="true" size={26} />
              <p>Drag event photos here, or</p>
              <input
                accept={ACCEPT_ATTRIBUTE}
                aria-hidden="true"
                className="visually-hidden"
                disabled={isBusy}
                id="photo-files"
                multiple
                onChange={(event) => pick(event.target.files)}
                ref={inputRef}
                tabIndex={-1}
                type="file"
              />
              <button
                data-initial-focus
                className="button button-primary"
                disabled={isBusy}
                onClick={() => inputRef.current?.click()}
                type="button"
              >
                Choose photos
              </button>
              <p className="hint">JPEG or PNG, up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB each.</p>
            </div>
          ) : (
            <EmptyState
              action={
                <button className="button button-primary" onClick={onGoToGuests} type="button">
                  Add a guest
                </button>
              }
              title="Add a guest first"
            >
              Photos can only match guests who already have reference photos. Add at least one
              guest, then come back to upload.
            </EmptyState>
          )}
        </Dialog>
      )}

      {rejected.length > 0 && (
        <section aria-label="Files that weren't uploaded" className="panel panel-warn">
          <div className="panel-head">
            <h3>{pluralize(rejected.length, "file")} not uploaded</h3>
            <button className="text-button" onClick={onDismissRejected} type="button">
              Dismiss
            </button>
          </div>
          <ul className="issue-list">
            {rejected.map((item, index) => (
              <li key={`${item.name}:${index}`}>
                <strong className="truncate">{item.name}</strong> {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.length > 0 && (
        <section aria-label="Upload progress" className="upload-progress">
          <div className="panel-head">
            <h3>
              {doneCount} of {queue.length} photos done
            </h3>
            <div className="panel-actions">
              {retryable.length > 0 && !isBusy && (
                <button className="button" onClick={onRetry} type="button">
                  Retry {retryable.length}
                </button>
              )}
              {hasUncertain && !isUploading && (
                <button className="button" onClick={onRefresh} type="button">
                  Refresh library
                </button>
              )}
              {!isBusy && (
                <button className="text-button" onClick={onDismissQueue} type="button">
                  Clear
                </button>
              )}
            </div>
          </div>
          <progress aria-label="Upload progress" max={queue.length} value={doneCount} />
          <ul className="queue-list">
            {queue.map((item) => (
              <li className={`queue-item queue-${item.status}`} key={item.id}>
                <span className="queue-icon">{queueIcon(item.status)}</span>
                <span className="truncate queue-name">{item.name}</span>
                <span className="queue-status">
                  <strong>{queueStatusText[item.status]}.</strong>
                  {item.message ? ` ${item.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="gallery-title" className="section">
        {photos.length > 0 && <div className="photo-tools"><button className="button" disabled={isBusy || !hasGuests} onClick={onFindGuest} type="button"><Search aria-hidden="true" size={17} /> Find a guest in existing photos</button></div>}
        <div className="section-head">
          <h2 className="visually-hidden" id="gallery-title">
            Photo library
          </h2>
          {photos.length > 0 && (
            <div className="filters">
              <label className="visually-hidden" htmlFor="photo-guest-filter">
                Show photos for
              </label>
              <select
                id="photo-guest-filter"
                onChange={(event) => {
                  setGuestFilter(event.target.value);
                  setVisibleCount(pageSize);
                }}
                value={guestFilter}
              >
                <option value="all">All photos</option>
                <option value={noMatchFilter}>No guest matched</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <label className="visually-hidden" htmlFor="photo-search">
                Search by file or guest name
              </label>
              <input
                id="photo-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleCount(pageSize);
                }}
                placeholder="Search photos"
                type="search"
                value={query}
              />
            </div>
          )}
        </div>

        {photos.length === 0 ? (
          <EmptyState title="No event photos yet">
            Photos you upload appear here with the guests they may contain.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="No photos match this filter">
            Try another guest or clear the search.
          </EmptyState>
        ) : (
          <>
            <ul className="photo-grid">
              {shown.map((photo) => {
                const firstItem = inspectorItems.find((item) => item.photo.id === photo.id);
                return (
                  <li className="photo-card" key={photo.id}>
                    <button
                      aria-label={`View ${photo.name} full size`}
                      className="photo-thumb"
                      disabled={!firstItem}
                      onClick={() => firstItem && setInspectorKey(firstItem.key)}
                      type="button"
                    >
                      <PhotoImage
                        alt={`Event photo ${photo.name}`}
                        className="photo-thumb-image"
                        src={photo.previewUrl}
                      />
                    </button>
                    <div className="photo-card-body">
                      <div className="photo-card-title">
                        <h3 className="truncate" title={photo.name}>
                          {photo.name}
                        </h3>
                        <button aria-label={`Add a guest to ${photo.name}`} className="button button-icon" disabled={isBusy || !hasGuests} onClick={() => setAssigning(photo)} title="Add a missed guest" type="button"><UserRoundPlus aria-hidden="true" size={17} /></button>
                        <button
                          aria-label={`Delete ${photo.name}`}
                          className="button button-icon button-quiet-danger"
                          disabled={isBusy}
                          onClick={() => setPendingDelete(photo)}
                          title="Delete photo"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </div>
                      {photo.size > 0 && <p className="meta">{formatBytes(photo.size)}</p>}
                      {photo.matches.length === 0 ? (
                        <p className="meta">No guest matched</p>
                      ) : (
                        <ul className="match-list">
                          {photo.matches.map((match) => (
                            <li key={match.personId}>
                              <span className="truncate">{match.personName}</span>
                              <span className="score">{match.source === "manual" ? "Added by you" : formatScore(match.confidence)}</span>
                              <StatusBadge status={match.status} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
      </section>

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

      {pendingDelete && (
        <ConfirmDialog
          confirmLabel="Delete photo"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const photo = pendingDelete;
            setPendingDelete(null);
            onDeletePhoto(photo);
          }}
          title={`Delete ${pendingDelete.name}?`}
        >
          <p>
            This permanently removes the photo and its match records from this event. This can't be
            undone.
          </p>
        </ConfirmDialog>
      )}
      {assigning && <AssignGuest busy={isBusy} error={submissionError} onAssign={onAssignGuest} onClose={() => setAssigning(null)} people={people} photo={assigning} />}
    </div>
  );
}
