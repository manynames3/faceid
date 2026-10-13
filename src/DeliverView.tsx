import { ClipboardCopy, Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildManifest,
  csvFilename,
  guestFilenamesText,
  manifestToCsv,
  manifestToText,
} from "./delivery";
import { pluralize } from "./format";
import type { Person, PhotoAsset } from "./types";
import { Avatar, EmptyState, PhotoImage } from "./ui";

type Feedback = { text: string; tone: "success" | "error" };

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function DeliverView({
  eventId,
  eventName,
  onGoToReview,
  people,
  photos,
}: {
  eventId: string;
  eventName: string;
  onGoToReview: () => void;
  people: Person[];
  photos: PhotoAsset[];
}) {
  const manifest = useMemo(
    () => buildManifest({ eventId, people, photos }),
    [eventId, people, photos],
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const isPartial = manifest.pendingCount > 0;
  const isEmpty = manifest.rowCount === 0;

  function downloadCsv() {
    const csv = `\uFEFF${manifestToCsv(manifest.rows)}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(eventName, { partial: isPartial });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFeedback({
      text: isPartial
        ? `Downloaded a partial CSV with ${pluralize(manifest.rowCount, "approved guest-photo pair")}.`
        : `Downloaded a CSV with ${pluralize(manifest.rowCount, "approved guest-photo pair")}.`,
      tone: "success",
    });
  }

  async function copy(text: string, label: string) {
    const copied = await copyText(text);
    setFeedback(
      copied
        ? { text: `Copied ${label}.`, tone: "success" }
        : {
            text: "Couldn't copy automatically. Download the CSV instead, or select the filenames below.",
            tone: "error",
          },
    );
  }

  return (
    <div className="view deliver-view">
      <section aria-labelledby="deliver-title" className="delivery-overview">
        <div className="view-heading">
          <div>
            <h1 id="deliver-title">Approved photo list</h1>
            <p className="view-subtitle">A personal list for each guest, ready for your handoff.</p>
          </div>
        </div>

        {isEmpty ? (
          <EmptyState
            action={
              manifest.pendingCount > 0 ? (
                <button className="button button-primary" onClick={onGoToReview} type="button">
                  Review {pluralize(manifest.pendingCount, "match", "matches")}
                </button>
              ) : undefined
            }
            title="Nothing approved yet"
          >
            Approve matches in Review and they'll be listed here. Pending and rejected matches are
            never included.
          </EmptyState>
        ) : (
          <p className="deliver-summary">
            <strong>{pluralize(manifest.uniquePhotoCount, "photo")}</strong> approved for{" "}
            <strong>{pluralize(manifest.guests.length, "guest")}</strong>
            {manifest.rowCount !== manifest.uniquePhotoCount && (
              <span className="muted">
                {" "}
                ({pluralize(manifest.rowCount, "guest-photo pair")}, since some photos include more
                than one guest)
              </span>
            )}
          </p>
        )}

        {isPartial && !isEmpty && (
          <div className="callout callout-warn">
            <p>
              {pluralize(manifest.pendingCount, "match", "matches")} still{" "}
              {manifest.pendingCount === 1 ? "needs" : "need"} a decision and{" "}
              {manifest.pendingCount === 1 ? "is" : "are"} left out, so this list is partial.
            </p>
            <button className="button" onClick={onGoToReview} type="button">
              Review them
            </button>
          </div>
        )}

        {!isEmpty && (
          <div className="actions">
            <button
              className="button button-primary"
              disabled={isEmpty}
              onClick={downloadCsv}
              type="button"
            >
              <Download aria-hidden="true" size={18} />
              {isPartial ? "Download partial CSV" : "Download CSV"}
            </button>
            <button
              className="button"
              disabled={isEmpty}
              onClick={() => void copy(manifestToText(manifest), "all filenames, grouped by guest")}
              type="button"
            >
              <ClipboardCopy aria-hidden="true" size={18} />
              Copy all filenames
            </button>
          </div>
        )}

        <div aria-live="polite" role="status">
          {feedback && (
            <p className={feedback.tone === "error" ? "field-error" : "meta"}>{feedback.text}</p>
          )}
        </div>

        <p className="hint">
          Exports contain approved filenames, not the photos themselves. Deliver photos through your
          usual gallery service.
        </p>
      </section>

      {!isEmpty && (
        <section aria-labelledby="by-guest-title" className="section">
          <h2 className="section-title" id="by-guest-title">
            By guest <span className="muted">{manifest.guests.length}</span>
          </h2>
          <ul className="deliver-list">
            {manifest.guests.map((guest) => (
              <li className="deliver-row" key={guest.guestId}>
                <div className="deliver-row-head">
                  <Avatar
                    person={
                      people.find((person) => person.id === guest.guestId) ?? {
                        name: guest.guestName,
                        initials: guest.guestName.slice(0, 1),
                      }
                    }
                  />
                  <h3 className="truncate">{guest.guestName}</h3>
                  <span className="muted">{pluralize(guest.filenames.length, "photo")}</span>
                  <button
                    className="button"
                    onClick={() =>
                      void copy(guestFilenamesText(guest), `${guest.guestName}'s filenames`)
                    }
                    type="button"
                  >
                    <ClipboardCopy aria-hidden="true" size={17} />
                    Copy filenames
                  </button>
                </div>
                <div className="delivery-previews">
                  {guest.rows.slice(0, 4).map((row) => {
                    const photo = photos.find((item) => item.id === row.photoId);
                    return photo ? (
                      <PhotoImage alt={photo.name} key={photo.id} src={photo.previewUrl} />
                    ) : null;
                  })}
                  {guest.rows.length > 4 && <span>+{guest.rows.length - 4} more</span>}
                </div>
                <details>
                  <summary>Show filenames</summary>
                  <ul className="filename-list">
                    {guest.rows.map((row) => (
                      <li className="truncate" key={row.photoId}>
                        {row.filename}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
