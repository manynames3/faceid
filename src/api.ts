import type { Person, PhotoAsset, PhotoMatch, UploadMode, UploadResult } from "./types";

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const apiBaseUrl = rawApiBaseUrl?.replace(/\/$/, "");

type UploadPayload = {
  mode: UploadMode;
  files: File[];
  people: Person[];
};

export const hasConfiguredApi = Boolean(apiBaseUrl);

type PresignResponse = {
  uploads: Array<{
    name: string;
    key: string;
    url: string;
    headers: Record<string, string>;
  }>;
};

type UploadedFile = {
  name: string;
  key: string;
  size: number;
  type: string;
};

export async function fetchLibrary(): Promise<UploadResult> {
  if (!apiBaseUrl) {
    return { people: [], photos: [] };
  }

  const response = await fetch(`${apiBaseUrl}/library`);
  if (!response.ok) {
    throw new Error(`Library load failed with status ${response.status}`);
  }

  return response.json() as Promise<UploadResult>;
}

export async function submitUpload({
  mode,
  files,
  people,
}: UploadPayload): Promise<UploadResult> {
  if (!apiBaseUrl) {
    return simulateUpload(mode, files, people);
  }

  const presignResponse = await fetch(`${apiBaseUrl}/uploads/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      })),
    }),
  });

  if (!presignResponse.ok) {
    throw new Error(`Upload setup failed with status ${presignResponse.status}`);
  }

  const { uploads } = (await presignResponse.json()) as PresignResponse;
  const uploadedFiles: UploadedFile[] = [];

  for (const [index, file] of files.entries()) {
    const upload = uploads[index];
    if (!upload) {
      throw new Error(`No upload URL returned for ${file.name}`);
    }

    const putResponse = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: file,
    });

    if (!putResponse.ok) {
      throw new Error(`S3 upload failed for ${file.name}`);
    }

    uploadedFiles.push({
      name: file.name,
      key: upload.key,
      size: file.size,
      type: file.type || "application/octet-stream",
    });
  }

  const response = await fetch(`${apiBaseUrl}/uploads/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, files: uploadedFiles }),
  });

  if (!response.ok) {
    throw new Error(`Photo processing failed with status ${response.status}`);
  }

  return response.json() as Promise<UploadResult>;
}

async function simulateUpload(
  mode: UploadMode,
  files: File[],
  people: Person[],
): Promise<UploadResult> {
  await new Promise((resolve) => window.setTimeout(resolve, 650));

  if (mode === "references") {
    const nextPeople = files.map((file) => {
      const name = nameFromFilename(file.name);
      return {
        id: `person-${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`,
        name,
        initials: initialsFromName(name),
        referenceCount: 1,
        photoCount: 0,
      };
    });

    return { people: nextPeople, photos: [] };
  }

  const fallbackPerson: Person = {
    id: "unknown",
    name: "Unknown",
    initials: "?",
    referenceCount: 0,
    photoCount: 0,
  };

  const seededPeople = people.length > 0 ? people : [fallbackPerson];
  const photos = files.map((file, index) => {
    const primary = seededPeople[index % seededPeople.length];
    const secondary = seededPeople[(index + 1) % seededPeople.length];
    const confidence = 72 + ((file.name.length * 7 + index * 11) % 270) / 10;
    const includeSecond = seededPeople.length > 1 && index % 3 === 0;

    const matches: PhotoMatch[] = [
      {
        personId: primary.id,
        personName: primary.name,
        confidence,
        status: confidence >= 86 ? "matched" : "review",
      },
    ];

    if (includeSecond) {
      matches.push({
        personId: secondary.id,
        personName: secondary.name,
        confidence: 88.1,
        status: "matched",
      });
    }

    return {
      id: `photo-${crypto.randomUUID()}`,
      name: file.name,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      previewUrl: URL.createObjectURL(file),
      matches,
    } satisfies PhotoAsset;
  });

  return { people: [], photos };
}

function nameFromFilename(filename: string) {
  const nameWithoutExtension = filename.replace(/\.[^.]+$/, "");
  return nameWithoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+\d+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initialsFromName(name: string) {
  const parts = name.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
