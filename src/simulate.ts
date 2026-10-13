import type { Person, PhotoAsset, PhotoMatch, UploadMode, UploadResult } from "./types";

type SimulatedUpload = {
  delayMs?: number;
  files: File[];
  guestName?: string;
  mode: UploadMode;
  people: Person[];
  personId?: string;
};

/** Stable pseudo-random number from a file name, so a sample re-run looks the same. */
function hashName(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Sample-mode stand-in for the service. Scores are made up from the file name;
 * no image is analysed and nothing leaves the browser.
 */
export async function simulateUpload({
  delayMs = 600,
  files,
  guestName,
  mode,
  people,
  personId,
}: SimulatedUpload): Promise<UploadResult> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (mode === "references") {
    const existing = personId ? people.find((person) => person.id === personId) : undefined;
    const name = (existing?.name ?? guestName ?? "").replace(/\s+/g, " ").trim();
    if (!name) {
      throw new Error("A guest name is required.");
    }

    const person: Person = existing
      ? {
          ...existing,
          referenceCount: existing.referenceCount + files.length,
          referencePreviewUrl: existing.referencePreviewUrl ?? URL.createObjectURL(files[0]),
        }
      : {
          id: `person-sample-${crypto.randomUUID().slice(0, 12)}`,
          name,
          initials: initialsFromName(name),
          consentStatus: "captured",
          consentSource: "owner_attested",
          consentCapturedAt: new Date().toISOString(),
          referenceCount: files.length,
          photoCount: 0,
          referencePreviewUrl: URL.createObjectURL(files[0]),
        };

    return { people: [person], photos: [] };
  }

  const photos = files.map((file): PhotoAsset => {
    const hash = hashName(`${file.name}:${file.size}`);
    const matches: PhotoMatch[] = [];

    // Roughly one photo in six has no match, to show that state honestly.
    if (people.length > 0 && hash % 6 !== 0) {
      const primary = people[hash % people.length];
      const score = 76 + ((hash >>> 3) % 235) / 10;
      matches.push(simulatedMatch(primary, Math.min(score, 99.4)));

      if (people.length > 1 && (hash >>> 5) % 4 === 0) {
        const secondary = people[(hash + 1) % people.length];
        matches.push(simulatedMatch(secondary, 75 + ((hash >>> 7) % 130) / 10));
      }
    }

    return {
      id: `photo-sample-${crypto.randomUUID()}`,
      name: file.name,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      previewUrl: URL.createObjectURL(file),
      matches,
    };
  });

  return { people: [], photos };
}

function simulatedMatch(person: Person, score: number): PhotoMatch {
  const confidence = Math.round(score * 10) / 10;
  return {
    personId: person.id,
    personName: person.name,
    confidence,
    status: confidence >= 90 ? "matched" : "needs_review",
  };
}

export function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0]);
  const first = parts[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return `${first}${last}`.toUpperCase();
}
