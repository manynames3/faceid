import { describe, expect, it } from "vitest";
import {
  buildInspectorItems,
  countPendingDecisions,
  dedupeMatches,
  deriveGuestStats,
  emptyLibrary,
  libraryReducer,
  upsertPeople,
  upsertPhotos,
  type LibraryState,
} from "./library";
import type { MatchStatus, Person, PhotoAsset, PhotoMatch } from "./types";

function person(id: string, name: string, referenceCount = 1): Person {
  return { id, initials: name[0], name, photoCount: 0, referenceCount };
}

function match(
  personId: string,
  status: MatchStatus,
  confidence = 90,
  reviewedAt?: string,
): PhotoMatch {
  return { confidence, personId, personName: personId, reviewedAt, status };
}

function photo(id: string, matches: PhotoMatch[]): PhotoAsset {
  return { id, matches, name: `${id}.jpg`, previewUrl: `/${id}.jpg`, size: 1, uploadedAt: "" };
}

describe("upsertPeople", () => {
  it("replaces counts with the latest snapshot instead of adding them", () => {
    const first = [person("p1", "Ava", 1)];
    const afterSecondReference = upsertPeople(first, [person("p1", "Ava", 2)]);
    const afterRepeat = upsertPeople(afterSecondReference, [person("p1", "Ava", 2)]);

    expect(afterRepeat).toHaveLength(1);
    expect(afterRepeat[0].referenceCount).toBe(2);
  });

  it("keeps guests with the same name apart when their ids differ", () => {
    const merged = upsertPeople([person("p1", "Sam Lee")], [person("p2", "Sam Lee")]);
    expect(merged.map((item) => item.id)).toEqual(["p1", "p2"]);
  });

  it("keeps the guest list sorted by name", () => {
    const merged = upsertPeople([person("p2", "Zoe")], [person("p1", "Ava")]);
    expect(merged.map((item) => item.name)).toEqual(["Ava", "Zoe"]);
  });
});

describe("dedupeMatches", () => {
  it("keeps one record per guest, preferring the reviewed one", () => {
    const result = dedupeMatches([
      match("p1", "needs_review", 99),
      match("p1", "approved", 80, "2026-05-20T10:00:00Z"),
      match("p2", "matched", 91),
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.personId === "p1")?.status).toBe("approved");
  });

  it("falls back to the higher score when neither was reviewed", () => {
    const result = dedupeMatches([match("p1", "matched", 88), match("p1", "matched", 93)]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(93);
  });
});

describe("derived counts", () => {
  const photos = [
    photo("a", [match("p1", "approved"), match("p2", "needs_review")]),
    photo("b", [match("p1", "matched"), match("p1", "matched")]),
    photo("c", [match("p2", "rejected")]),
  ];

  it("counts per guest from the photos on screen, with duplicates collapsed", () => {
    const stats = deriveGuestStats(photos);
    expect(stats.get("p1")).toEqual({ approved: 1, awaiting: 1, rejected: 0 });
    expect(stats.get("p2")).toEqual({ approved: 0, awaiting: 1, rejected: 1 });
  });

  it("counts every undecided status as a pending decision", () => {
    const withOthers = [
      ...photos,
      photo("d", [match("p3", "suggested"), match("p4", "unknown"), match("p5", "approved")]),
    ];
    // a:p2, b:p1, d:p3, d:p4
    expect(countPendingDecisions(withOthers)).toBe(4);
  });
});

describe("upsertPhotos", () => {
  it("puts new photos first and replaces an existing photo in place of duplicating it", () => {
    const current = [photo("a", [match("p1", "matched")]), photo("b", [])];
    const result = upsertPhotos(current, [
      photo("c", []),
      photo("a", [match("p1", "matched"), match("p1", "matched", 70)]),
    ]);
    expect(result.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(result.find((item) => item.id === "a")?.matches).toHaveLength(1);
  });
});

describe("libraryReducer", () => {
  const loaded: LibraryState = libraryReducer(
    libraryReducer(emptyLibrary, { type: "load-start", eventId: "event-1" }),
    {
      type: "loaded",
      eventId: "event-1",
      people: [person("p1", "Ava")],
      photos: [photo("a", [match("p1", "matched")])],
    },
  );

  it("clears the previous event immediately when another is selected", () => {
    const next = libraryReducer(loaded, { type: "load-start", eventId: "event-2" });
    expect(next).toMatchObject({ eventId: "event-2", people: [], photos: [], status: "loading" });
  });

  it("keeps what is on screen when the same event is refreshed", () => {
    const next = libraryReducer(loaded, { type: "load-start", eventId: "event-1" });
    expect(next.status).toBe("loading");
    expect(next.photos).toHaveLength(1);
  });

  it("drops late results that belong to a different event", () => {
    const switched = libraryReducer(loaded, { type: "load-start", eventId: "event-2" });

    const afterLateLoad = libraryReducer(switched, {
      type: "loaded",
      eventId: "event-1",
      people: [person("p1", "Ava")],
      photos: [photo("a", [])],
    });
    const afterLateUpload = libraryReducer(switched, {
      type: "merge-upload",
      eventId: "event-1",
      result: { people: [], photos: [photo("late", [])] },
    });
    const afterLateFailure = libraryReducer(switched, {
      type: "load-failed",
      eventId: "event-1",
      message: "late",
    });

    expect(afterLateLoad).toBe(switched);
    expect(afterLateUpload).toBe(switched);
    expect(afterLateFailure).toBe(switched);
  });

  it("applies a review decision to the matching guest only", () => {
    const next = libraryReducer(loaded, {
      type: "match-updated",
      eventId: "event-1",
      photoId: "a",
      match: match("p1", "approved", 90, "2026-05-20T10:00:00Z"),
    });
    expect(next.photos[0].matches[0].status).toBe("approved");
  });

  it("removes a deleted guest and their matches", () => {
    const next = libraryReducer(loaded, {
      type: "person-removed",
      eventId: "event-1",
      personId: "p1",
    });
    expect(next.people).toEqual([]);
    expect(next.photos[0].matches).toEqual([]);
  });
});

describe("buildInspectorItems", () => {
  it("includes photos with no match so they can still be inspected", () => {
    const items = buildInspectorItems(
      [photo("a", [match("p1", "matched")]), photo("b", [])],
      [person("p1", "Ava")],
    );
    expect(items.map((item) => item.key)).toEqual(["a:p1", "b:none"]);
    expect(items[1].entry).toBeNull();
  });
});
