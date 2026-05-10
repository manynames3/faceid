import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "./auth";

const authSession: AuthSession = {
  accessToken: "access-token",
  expiresAt: Date.now() + 60_000,
  idToken: "id-token",
  userId: "user-1",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("submitUpload", () => {
  it("passes issued upload session IDs into processing requests", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          uploads: [
            {
              headers: {
                "Content-Type": "image/jpeg",
                "x-amz-meta-upload-id": "upload-123",
              },
              key: "users/user-1/photos/2026/05/09/photo.jpg",
              name: "photo.jpg",
              uploadId: "upload-123",
              url: "https://s3.example.test/upload",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ people: [], photos: [] }));

    vi.stubGlobal("fetch", fetchMock);

    const { submitUpload } = await import("./api");
    const file = new File(["image-bytes"], "photo.jpg", { type: "image/jpeg" });

    await submitUpload({
      files: [file],
      mode: "photos",
      people: [],
      session: authSession,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/uploads/presign",
    );
    expect(fetchMock.mock.calls[1][0]).toBe("https://s3.example.test/upload");
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://api.example.test/uploads/process",
    );

    const processOptions = fetchMock.mock.calls[2][1] as RequestInit;
    expect(processOptions.headers).toMatchObject({
      Authorization: "Bearer id-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(processOptions.body))).toEqual({
      files: [
        {
          key: "users/user-1/photos/2026/05/09/photo.jpg",
          name: "photo.jpg",
          size: file.size,
          type: "image/jpeg",
          uploadId: "upload-123",
        },
      ],
      mode: "photos",
    });
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
