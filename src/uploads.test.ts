import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromStatus } from "./errors";
import {
  chunkFiles,
  isRetryableUpload,
  MAX_UPLOAD_BYTES,
  runUploadChunks,
  summarizeUploads,
  validateImageFiles,
  type FileLike,
} from "./uploads";

function file(name: string, size = 1000, type = "image/jpeg"): FileLike {
  return { name, size, type };
}

describe("upload confirmation", () => {
  it("does not count uncertain or incomplete responses as uploaded photos", () => {
    expect(summarizeUploads(["done", "uncertain", "failed", "skipped"])).toEqual({
      saved: 1, total: 4, attention: 3,
    });
  });

  it("counts a refreshed and reconciled photo as saved", () => {
    expect(summarizeUploads(["done", "done"])).toEqual({saved: 2, total: 2, attention: 0});
  });

  it("does not automatically resend a photo that may still be processing", () => {
    expect(isRetryableUpload("uncertain")).toBe(false);
    expect(isRetryableUpload("sending")).toBe(false);
    expect(isRetryableUpload("failed")).toBe(true);
    expect(isRetryableUpload("skipped")).toBe(true);
  });
});

describe("validateImageFiles", () => {
  it("accepts JPEG and PNG and reports every file it rejects, with a reason", () => {
    const { accepted, rejected } = validateImageFiles([
      file("ok.jpg"),
      file("ok.png", 5000, "image/png"),
      file("empty.jpg", 0),
      file("doc.pdf", 1000, "application/pdf"),
      file("anim.gif", 1000, "image/gif"),
      file("huge.jpg", MAX_UPLOAD_BYTES + 1),
      file("untyped", 1000, ""),
    ]);

    expect(accepted.map((item) => item.name)).toEqual(["ok.jpg", "ok.png"]);
    expect(rejected.map((item) => item.name)).toEqual([
      "empty.jpg",
      "doc.pdf",
      "anim.gif",
      "huge.jpg",
      "untyped",
    ]);
    expect(rejected[0].reason).toMatch(/empty/i);
    expect(rejected[1].reason).toMatch(/JPEG and PNG/);
    expect(rejected[3].reason).toMatch(/15 MB/);
  });

  it("allows exactly the size limit", () => {
    const { accepted } = validateImageFiles([file("edge.jpg", MAX_UPLOAD_BYTES)]);
    expect(accepted).toHaveLength(1);
  });

  it("flags the same file selected twice", () => {
    const { accepted, rejected } = validateImageFiles([file("a.jpg"), file("a.jpg")]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([{ name: "a.jpg", reason: "It was selected twice." }]);
  });

  it("limits reference photos instead of silently dropping the extras", () => {
    const { accepted, rejected } = validateImageFiles(
      [file("1.jpg"), file("2.jpg", 2000), file("3.jpg", 3000)],
      { maxFiles: 2 },
    );
    expect(accepted.map((item) => item.name)).toEqual(["1.jpg", "2.jpg"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/Only 2 reference photos/);
  });
});

describe("chunkFiles", () => {
  it("splits into the requested request size", () => {
    expect(chunkFiles([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkFiles([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    expect(chunkFiles([], 2)).toEqual([]);
  });
});

describe("runUploadChunks", () => {
  it("keeps results for the chunks that worked when one fails", async () => {
    const done: string[] = [];
    const failed: string[] = [];

    const outcomes = await runUploadChunks(
      chunkFiles(["a", "b", "c"], 1),
      async ([name]) => {
        if (name === "b") {
          throw apiErrorFromStatus(400, "b.jpg has no face");
        }
        return `saved ${name}`;
      },
      {
        onDone: ([name]) => done.push(name),
        onFailed: ([name]) => failed.push(name),
      },
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["done", "failed", "done"]);
    expect(done).toEqual(["a", "c"]);
    expect(failed).toEqual(["b"]);
  });

  it("stops sending after the session expires and marks the rest as skipped", async () => {
    const sent: string[] = [];

    const outcomes = await runUploadChunks(chunkFiles(["a", "b", "c"], 1), async ([name]) => {
      sent.push(name);
      if (name === "a") {
        throw apiErrorFromStatus(401);
      }
      return name;
    });

    expect(sent).toEqual(["a"]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["failed", "skipped", "skipped"]);
  });

  it("stops when asked to, e.g. after the user switched events", async () => {
    let allowed = true;
    const outcomes = await runUploadChunks(
      chunkFiles(["a", "b"], 1),
      async ([name]) => {
        allowed = false;
        return name;
      },
      { shouldContinue: () => allowed },
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["done", "skipped"]);
  });

  it("carries the uncertain flag so callers can refresh before retrying", async () => {
    const outcomes = await runUploadChunks([["a"]], async () => {
      throw apiErrorFromStatus(504, undefined, "process");
    });
    const outcome = outcomes[0];
    expect(outcome.status).toBe("failed");
    expect(
      outcome.status === "failed" && outcome.error instanceof ApiError && outcome.error.uncertain,
    ).toBe(true);
  });
});
