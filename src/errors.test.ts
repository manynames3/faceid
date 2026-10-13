import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromStatus, networkError, sanitizeServerMessage } from "./errors";

describe("apiErrorFromStatus", () => {
  it("maps 401 to a session-expired error that tells the user to sign in again", () => {
    const error = apiErrorFromStatus(401, "Unauthorized");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("session_expired");
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/sign in again/i);
  });

  it("maps 429 to a wait-and-retry message", () => {
    const error = apiErrorFromStatus(429);
    expect(error.kind).toBe("rate_limited");
    expect(error.message).toMatch(/wait/i);
  });

  it("shows the server's detail for a 400 but not for a 5xx", () => {
    expect(apiErrorFromStatus(400, "Upload at most 10 files per batch.").message).toBe(
      "Upload at most 10 files per batch.",
    );
    const server = apiErrorFromStatus(502, "AWS service call failed: arn:aws:internal");
    expect(server.kind).toBe("server");
    expect(server.message).not.toContain("arn:aws");
  });

  it("falls back to a generic 400 message when the body has no usable text", () => {
    expect(apiErrorFromStatus(400, { nested: true }).message).toMatch(/wasn't accepted/);
  });

  it("only treats a failed processing step as uncertain", () => {
    expect(apiErrorFromStatus(504, undefined, "process").uncertain).toBe(true);
    expect(networkError("process").uncertain).toBe(true);
    expect(apiErrorFromStatus(504, undefined, "presign").uncertain).toBe(false);
    expect(apiErrorFromStatus(400, "bad", "process").uncertain).toBe(false);
    expect(networkError("upload").uncertain).toBe(false);
  });
});

describe("sanitizeServerMessage", () => {
  it("strips control characters, collapses whitespace and bounds the length", () => {
    expect(sanitizeServerMessage("  Bad\u0000\n  name\t ")).toBe("Bad name");
    expect(sanitizeServerMessage("x".repeat(500))?.length).toBe(240);
    expect(sanitizeServerMessage("   ")).toBeUndefined();
    expect(sanitizeServerMessage(42)).toBeUndefined();
  });
});
