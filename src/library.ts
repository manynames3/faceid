import type {
  MatchStatus,
  Person,
  PhotoAsset,
  PhotoMatch,
  UploadResult,
} from "./types";

/** Anything that is not an explicit approve/reject still needs a human decision. */
export function isUndecided(status: MatchStatus) {
  return status !== "approved" && status !== "rejected";
}

/** Status as a word, so meaning never depends on colour alone. */
export function statusLabel(status: MatchStatus) {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "needs_review":
      return "Needs a closer look";
    case "matched":
    case "suggested":
      return "Suggested match";
    default:
      return "Unconfirmed";
  }
}

export function countPendingDecisions(photos: PhotoAsset[]) {
  let total = 0;
  for (const photo of photos) {
    for (const match of dedupeMatches(photo.matches)) {
      if (isUndecided(match.status)) {
        total += 1;
      }
    }
  }
  return total;
}

function reviewTime(match: PhotoMatch) {
  const time = match.reviewedAt ? Date.parse(match.reviewedAt) : NaN;
  return Number.isNaN(time) ? 0 : time;
}

/** One record per guest per photo: the most recently reviewed, then the highest score. */
export function dedupeMatches(matches: PhotoMatch[]): PhotoMatch[] {
  const byPerson = new Map<string, PhotoMatch>();

  for (const match of matches) {
    const existing = byPerson.get(match.personId);
    if (
      !existing ||
      reviewTime(match) > reviewTime(existing) ||
      (reviewTime(match) === reviewTime(existing) && match.confidence > existing.confidence)
    ) {
      byPerson.set(match.personId, match);
    }
  }

  return Array.from(byPerson.values()).sort((a, b) => b.confidence - a.confidence);
}

export function normalizePhoto(photo: PhotoAsset): PhotoAsset {
  return { ...photo, matches: dedupeMatches(photo.matches ?? []) };
}

/**
 * Upsert guests by id. The incoming record is an authoritative snapshot from
 * the service, so it replaces the old one instead of adding counts together.
 * Distinct guests that share a name stay distinct.
 */
export function upsertPeople(current: Person[], incoming: Person[]): Person[] {
  const byId = new Map(current.map((person) => [person.id, person]));
  for (const person of incoming) {
    byId.set(person.id, person);
  }
  return Array.from(byId.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** Upsert photos by id; new photos go first, replaced photos keep their newest data. */
export function upsertPhotos(current: PhotoAsset[], incoming: PhotoAsset[]): PhotoAsset[] {
  if (incoming.length === 0) {
    return current;
  }
  const incomingById = new Map<string, PhotoAsset>();
  for (const photo of incoming) {
    incomingById.set(photo.id, normalizePhoto(photo));
  }
  const kept = current.filter((photo) => !incomingById.has(photo.id));
  return [...incomingById.values(), ...kept];
}

export type GuestStats = {
  approved: number;
  awaiting: number;
  rejected: number;
};

/** Per-guest counts derived from the photos actually on screen. */
export function deriveGuestStats(photos: PhotoAsset[]): Map<string, GuestStats> {
  const stats = new Map<string, GuestStats>();

  for (const photo of photos) {
    for (const match of dedupeMatches(photo.matches)) {
      const entry = stats.get(match.personId) ?? { approved: 0, awaiting: 0, rejected: 0 };
      if (match.status === "approved") {
        entry.approved += 1;
      } else if (match.status === "rejected") {
        entry.rejected += 1;
      } else {
        entry.awaiting += 1;
      }
      stats.set(match.personId, entry);
    }
  }

  return stats;
}

export type ReviewEntry = {
  key: string;
  match: PhotoMatch;
  person: Person | undefined;
  photo: PhotoAsset;
};

export function matchKey(photoId: string, personId: string) {
  return `${photoId}:${personId}`;
}

export function buildReviewEntries(photos: PhotoAsset[], people: Person[]): ReviewEntry[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const entries: ReviewEntry[] = [];

  for (const photo of photos) {
    for (const match of dedupeMatches(photo.matches)) {
      entries.push({
        key: matchKey(photo.id, match.personId),
        match,
        person: peopleById.get(match.personId),
        photo,
      });
    }
  }

  return entries;
}

/** One step in the full-size inspector: a match to decide, or a photo that matched nobody. */
export type InspectorItem = {
  entry: ReviewEntry | null;
  key: string;
  photo: PhotoAsset;
};

export function buildInspectorItems(photos: PhotoAsset[], people: Person[]): InspectorItem[] {
  const items: InspectorItem[] = [];

  for (const photo of photos) {
    const entries = buildReviewEntries([photo], people);
    if (entries.length === 0) {
      items.push({ entry: null, key: `${photo.id}:none`, photo });
      continue;
    }
    for (const entry of entries) {
      items.push({ entry, key: entry.key, photo });
    }
  }

  return items;
}

export type LibraryState = {
  error: string | null;
  eventId: string | null;
  people: Person[];
  photos: PhotoAsset[];
  status: "idle" | "loading" | "ready" | "error";
};

export const emptyLibrary: LibraryState = {
  error: null,
  eventId: null,
  people: [],
  photos: [],
  status: "idle",
};

export type LibraryAction =
  | { type: "load-start"; eventId: string }
  | { type: "loaded"; eventId: string; people: Person[]; photos: PhotoAsset[] }
  | { type: "load-failed"; eventId: string; message: string }
  | { type: "merge-upload"; eventId: string; result: UploadResult }
  | { type: "photo-removed"; eventId: string; photoId: string }
  | { type: "person-removed"; eventId: string; personId: string }
  | { type: "match-updated"; eventId: string; photoId: string; match: PhotoMatch }
  | { type: "clear" };

/**
 * Every action carries the event it was started for. Anything that arrives
 * for an event other than the current one is dropped, so a slow response can
 * never land in a different event's workspace.
 */
export function libraryReducer(state: LibraryState, action: LibraryAction): LibraryState {
  if (action.type === "clear") {
    return emptyLibrary;
  }

  if (action.type === "load-start") {
    // Same event (refresh): keep what is on screen. Different event: clear it now.
    return action.eventId === state.eventId
      ? { ...state, error: null, status: "loading" }
      : { ...emptyLibrary, eventId: action.eventId, status: "loading" };
  }

  if (action.eventId !== state.eventId) {
    return state;
  }

  switch (action.type) {
    case "loaded":
      return {
        error: null,
        eventId: state.eventId,
        people: upsertPeople([], action.people),
        photos: action.photos.map(normalizePhoto),
        status: "ready",
      };
    case "load-failed":
      return { ...state, error: action.message, status: "error" };
    case "merge-upload":
      return {
        ...state,
        people: upsertPeople(state.people, action.result.people),
        photos: upsertPhotos(state.photos, action.result.photos),
      };
    case "photo-removed":
      return { ...state, photos: state.photos.filter((photo) => photo.id !== action.photoId) };
    case "person-removed":
      return {
        ...state,
        people: state.people.filter((person) => person.id !== action.personId),
        photos: state.photos.map((photo) => ({
          ...photo,
          matches: photo.matches.filter((match) => match.personId !== action.personId),
        })),
      };
    case "match-updated":
      return {
        ...state,
        photos: state.photos.map((photo) =>
          photo.id === action.photoId
            ? {
                ...photo,
                matches: photo.matches.map((match) =>
                  match.personId === action.match.personId
                    ? { ...match, ...action.match }
                    : match,
                ),
              }
            : photo,
        ),
      };
  }
}
