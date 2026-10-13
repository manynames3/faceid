import { describe, expect, it } from "vitest";
import {
  buildManifest,
  csvFilename,
  escapeCsvCell,
  manifestToCsv,
  manifestToText,
} from "./delivery";
import type { MatchStatus, Person, PhotoAsset } from "./types";

function person(id: string, name: string): Person {
  return { id, initials: name[0], name, photoCount: 0, referenceCount: 1 };
}

function photo(
  id: string,
  name: string,
  matches: Array<[string, string, MatchStatus, number?]>,
): PhotoAsset {
  return {
    id,
    matches: matches.map(([personId, personName, status, confidence = 90]) => ({
      confidence,
      personId,
      personName,
      reviewedAt: status === "approved" ? "2026-05-20T10:00:00Z" : undefined,
      status,
    })),
    name,
    previewUrl: `https://signed.example.test/${id}?X-Amz-Signature=secret`,
    size: 1000,
    uploadedAt: "2026-05-20T09:00:00Z",
  };
}

describe("buildManifest", () => {
  const people = [person("p1", "Sam Lee"), person("p2", "Sam Lee"), person("p3", "Ava")];
  const photos = [
    photo("a", "a.jpg", [
      ["p1", "Sam Lee", "approved", 97.25],
      ["p3", "Ava", "approved", 91],
    ]),
    photo("b", "b.jpg", [["p1", "Sam Lee", "approved"], ["p2", "Sam Lee", "needs_review"]]),
    photo("c", "c.jpg", [["p3", "Ava", "rejected"], ["p1", "Sam Lee", "matched"]]),
    photo("d", "d.jpg", []),
  ];
  const manifest = buildManifest({ eventId: "event-1", people, photos });

  it("includes approved matches only and counts what was left out", () => {
    expect(manifest.rows.map((row) => `${row.guestId}:${row.photoId}`).sort()).toEqual([
      "p1:a",
      "p1:b",
      "p3:a",
    ]);
    expect(manifest.pendingCount).toBe(2);
  });

  it("separates unique photos from guest-photo rows", () => {
    expect(manifest.rowCount).toBe(3);
    expect(manifest.uniquePhotoCount).toBe(2);
  });

  it("groups by guest id, so guests with the same name stay separate", () => {
    const sams = buildManifest({
      eventId: "event-1",
      people,
      photos: [
        photo("x", "x.jpg", [["p1", "Sam Lee", "approved"]]),
        photo("y", "y.jpg", [["p2", "Sam Lee", "approved"]]),
      ],
    });
    expect(sams.guests.map((guest) => guest.guestId).sort()).toEqual(["p1", "p2"]);
  });

  it("never carries signed image links into the exported rows or CSV", () => {
    const csv = manifestToCsv(manifest.rows);
    expect(csv).not.toContain("signed.example.test");
    expect(csv).not.toContain("X-Amz");
    expect(JSON.stringify(manifest.rows)).not.toContain("signed.example.test");
  });

  it("writes the identifying columns and one-decimal similarity", () => {
    const [header, firstRow] = manifestToCsv(manifest.rows).split("\r\n");
    expect(header).toBe(
      "event_id,guest_id,guest_name,photo_id,filename,similarity,reviewed_at",
    );
    expect(firstRow).toBe("event-1,p3,Ava,a,a.jpg,91.0,2026-05-20T10:00:00Z");
  });

  it("lists filenames per guest and in a grouped manifest", () => {
    const ava = manifest.guests.find((guest) => guest.guestId === "p3");
    expect(ava?.filenames).toEqual(["a.jpg"]);
    expect(manifestToText(manifest)).toBe("Ava\na.jpg\n\nSam Lee\na.jpg\nb.jpg");
  });

  it("is empty, not complete, when nothing is approved", () => {
    const empty = buildManifest({
      eventId: "event-1",
      people,
      photos: [photo("z", "z.jpg", [["p1", "Sam Lee", "matched"]])],
    });
    expect(empty.rowCount).toBe(0);
    expect(empty.pendingCount).toBe(1);
  });
});

describe("escapeCsvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(escapeCsvCell('Smith, "Jo"')).toBe('"Smith, ""Jo"""');
    expect(escapeCsvCell("two\nlines")).toBe('"two\nlines"');
    expect(escapeCsvCell("plain.jpg")).toBe("plain.jpg");
  });

  it("neutralises spreadsheet formula prefixes, including after whitespace", () => {
    for (const value of ["=SUM(A1)", "+1", "-1", "@cmd", " =1", "\t=1", "\r=1", "  @x"]) {
      const escaped = escapeCsvCell(value);
      expect(escaped.startsWith(`"'`)).toBe(true);
    }
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
  });

  it("keeps non-Latin names intact", () => {
    expect(escapeCsvCell("李小龍")).toBe("李小龍");
  });
});

describe("csvFilename", () => {
  it("builds a safe name and marks partial exports", () => {
    expect(csvFilename("Harper & Co. Wedding!")).toBe("harper-co-wedding-approved-photos.csv");
    expect(csvFilename("Gala", { partial: true })).toBe("gala-approved-photos-partial.csv");
    expect(csvFilename("李小龍")).toBe("event-approved-photos.csv");
  });
});
