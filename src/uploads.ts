import { ApiError, isSessionExpired } from "./errors";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** The matcher only compares a guest's first two references, so more are wasted. */
export const MAX_REFERENCE_FILES = 2;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(",");
/** Event photos go one per request so a slow match can't time out a whole batch. */
export const PHOTOS_PER_REQUEST = 1;

export type UploadStatus = "queued" | "sending" | "done" | "failed" | "uncertain" | "skipped";

export function summarizeUploads(statuses: Iterable<UploadStatus>) {
  let saved = 0;
  let total = 0;
  for (const status of statuses) {
    total += 1;
    if (status === "done") {
      saved += 1;
    }
  }
  return { saved, total, attention: total - saved };
}

export function isRetryableUpload(status: UploadStatus) {
  return status === "failed" || status === "skipped";
}

export type FileLike = { name: string; size: number; type: string };
export type RejectedFile = { name: string; reason: string };

export function formatBytes(size: number) {
  if (size < 1_000_000) {
    return `${Math.max(1, Math.round(size / 1000))} KB`;
  }
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

/**
 * Checks every selected file and reports each one that is dropped, rather
 * than silently ignoring the unsupported ones.
 */
export function validateImageFiles<T extends FileLike>(
  files: T[],
  { maxFiles }: { maxFiles?: number } = {},
): { accepted: T[]; rejected: RejectedFile[] } {
  const accepted: T[] = [];
  const rejected: RejectedFile[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const name = file.name || "Unnamed file";
    const duplicateKey = `${name}:${file.size}`;

    if (file.size === 0) {
      rejected.push({ name, reason: "The file is empty." });
    } else if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      rejected.push({ name, reason: "Only JPEG and PNG images are supported." });
    } else if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push({
        name,
        reason: `The file is ${formatBytes(file.size)}; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      });
    } else if (seen.has(duplicateKey)) {
      rejected.push({ name, reason: "It was selected twice." });
    } else if (maxFiles !== undefined && accepted.length >= maxFiles) {
      rejected.push({
        name,
        reason: `Only ${maxFiles} reference photo${maxFiles === 1 ? "" : "s"} per guest can be used.`,
      });
    } else {
      seen.add(duplicateKey);
      accepted.push(file);
    }
  }

  return { accepted, rejected };
}

export function chunkFiles<T>(files: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

export type ChunkOutcome<T, R> =
  | { chunk: T[]; result: R; status: "done" }
  | { chunk: T[]; error: unknown; status: "failed" }
  | { chunk: T[]; status: "skipped" };

/**
 * Sends chunks one after another and records a result for each, so one failed
 * file never discards the ones that already succeeded. After a session expiry
 * or a rate limit the remaining chunks are skipped rather than hammered.
 */
export async function runUploadChunks<T, R>(
  chunks: T[][],
  send: (chunk: T[], index: number) => Promise<R>,
  hooks: {
    onDone?: (chunk: T[], result: R, index: number) => void;
    onFailed?: (chunk: T[], error: unknown, index: number) => void;
    onStart?: (chunk: T[], index: number) => void;
    shouldContinue?: () => boolean;
  } = {},
): Promise<ChunkOutcome<T, R>[]> {
  const outcomes: ChunkOutcome<T, R>[] = [];
  let halted = false;

  for (const [index, chunk] of chunks.entries()) {
    if (halted || hooks.shouldContinue?.() === false) {
      halted = true;
      outcomes.push({ chunk, status: "skipped" });
      continue;
    }

    hooks.onStart?.(chunk, index);
    try {
      const result = await send(chunk, index);
      outcomes.push({ chunk, result, status: "done" });
      hooks.onDone?.(chunk, result, index);
    } catch (error) {
      outcomes.push({ chunk, error, status: "failed" });
      hooks.onFailed?.(chunk, error, index);
      if (isSessionExpired(error) || (error instanceof ApiError && error.kind === "rate_limited")) {
        halted = true;
      }
    }
  }

  return outcomes;
}

/** Plain-language summary of what a finished upload result actually contains. */
export function describePhotoResult(matchCount: number) {
  if (matchCount === 0) {
    return "Saved. No guest matched, so it isn't in any guest's list.";
  }
  return `Saved. ${matchCount} possible ${matchCount === 1 ? "match" : "matches"} to review.`;
}
