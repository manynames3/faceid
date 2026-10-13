import { dedupeMatches, isUndecided } from "./library";
import type { Person, PhotoAsset } from "./types";

export type ManifestRow = {
  eventId: string;
  filename: string;
  guestId: string;
  guestName: string;
  photoId: string;
  reviewedAt: string;
  similarity: number;
};

export type GuestManifest = {
  filenames: string[];
  guestId: string;
  guestName: string;
  rows: ManifestRow[];
};

export type Manifest = {
  guests: GuestManifest[];
  /** Matches still awaiting a decision; they are left out, so the list is partial. */
  pendingCount: number;
  /** Guest/photo pairs (a photo with two approved guests counts twice). */
  rowCount: number;
  rows: ManifestRow[];
  /** Distinct photos with at least one approved guest. */
  uniquePhotoCount: number;
};

/**
 * Approved matches only, grouped by guest id (never by name, so two guests
 * called "Sam" stay separate). Pending and rejected matches are excluded.
 */
export function buildManifest({
  eventId,
  people,
  photos,
}: {
  eventId: string;
  people: Person[];
  photos: PhotoAsset[];
}): Manifest {
  const namesById = new Map(people.map((person) => [person.id, person.name]));
  const rows: ManifestRow[] = [];
  let pendingCount = 0;

  for (const photo of photos) {
    for (const match of dedupeMatches(photo.matches)) {
      if (isUndecided(match.status)) {
        pendingCount += 1;
        continue;
      }
      if (match.status !== "approved") {
        continue;
      }
      rows.push({
        eventId,
        filename: photo.name,
        guestId: match.personId,
        guestName: namesById.get(match.personId) ?? match.personName,
        photoId: photo.id,
        reviewedAt: match.reviewedAt ?? "",
        similarity: match.confidence,
      });
    }
  }

  const byGuest = new Map<string, GuestManifest>();
  for (const row of rows) {
    const guest = byGuest.get(row.guestId) ?? {
      filenames: [],
      guestId: row.guestId,
      guestName: row.guestName,
      rows: [],
    };
    guest.rows.push(row);
    byGuest.set(row.guestId, guest);
  }

  const guests = Array.from(byGuest.values())
    .map((guest) => {
      const sorted = [...guest.rows].sort(
        (a, b) => a.filename.localeCompare(b.filename) || a.photoId.localeCompare(b.photoId),
      );
      return { ...guest, filenames: sorted.map((row) => row.filename), rows: sorted };
    })
    .sort((a, b) => a.guestName.localeCompare(b.guestName) || a.guestId.localeCompare(b.guestId));

  return {
    guests,
    pendingCount,
    rowCount: rows.length,
    rows: guests.flatMap((guest) => guest.rows),
    uniquePhotoCount: new Set(rows.map((row) => row.photoId)).size,
  };
}

// Spreadsheet apps run a cell as a formula when it starts with one of these,
// even after leading whitespace or control characters.
// eslint-disable-next-line no-control-regex
const formulaPrefix = /^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;
const needsQuotes = /[",\r\n]|^\s|\s$/;

/** Quotes a CSV cell and neutralises spreadsheet formula prefixes. */
export function escapeCsvCell(value: string | number): string {
  let text = String(value);
  let forceQuote = false;

  if (formulaPrefix.test(text)) {
    text = `'${text}`;
    forceQuote = true;
  }
  if (forceQuote || needsQuotes.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const csvHeader = [
  "event_id",
  "guest_id",
  "guest_name",
  "photo_id",
  "filename",
  "similarity",
  "reviewed_at",
];

/** Signed image URLs are deliberately never exported: they are expiring bearer links. */
export function manifestToCsv(rows: ManifestRow[]): string {
  const lines = [csvHeader.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.eventId,
        row.guestId,
        row.guestName,
        row.photoId,
        row.filename,
        Number.isFinite(row.similarity) ? row.similarity.toFixed(1) : "",
        row.reviewedAt,
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function guestFilenamesText(guest: GuestManifest): string {
  return guest.filenames.join("\n");
}

export function manifestToText(manifest: Manifest): string {
  return manifest.guests
    .map((guest) => `${guest.guestName}\n${guestFilenamesText(guest)}`)
    .join("\n\n");
}

export function csvFilename(eventName: string, { partial = false } = {}): string {
  const slug = eventName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "event"}-approved-photos${partial ? "-partial" : ""}.csv`;
}
