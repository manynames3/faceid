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
      eventId: "event-1",
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
      eventId: "event-1",
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

    const presignOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(presignOptions.body))).toMatchObject({
      eventId: "event-1",
      mode: "photos",
    });
  });
});

describe("delete requests", () => {
  it("sends authenticated delete requests for photos and people", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { deletePerson, deletePhoto } = await import("./api");

    await deletePhoto("photo 1", authSession);
    await deletePerson("person/1", authSession);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/photos/photo%201",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer id-token" },
      method: "DELETE",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.example.test/people/person%2F1",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer id-token" },
      method: "DELETE",
    });
  });
});

describe("events and review updates", () => {
  it("loads and creates authenticated event workspaces", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              createdAt: "2026-05-11T00:00:00Z",
              id: "event-1",
              name: "Spring Gala",
              status: "active",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          event: {
            createdAt: "2026-05-11T00:00:00Z",
            id: "event-2",
            name: "Roadshow",
            status: "active",
          },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { createEvent, fetchEvents } = await import("./api");

    const events = await fetchEvents(authSession);
    const created = await createEvent("Roadshow", authSession);

    expect(events[0].id).toBe("event-1");
    expect(created.id).toBe("event-2");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/events");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: {
        Authorization: "Bearer id-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("patches match review decisions", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        match: {
          confidence: 82.5,
          personId: "person-1",
          personName: "Jane Doe",
          status: "approved",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { updateMatchStatus } = await import("./api");
    const match = await updateMatchStatus({
      photoId: "photo 1",
      personId: "person/1",
      session: authSession,
      status: "approved",
    });

    expect(match?.status).toBe("approved");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/matches/photo%201/person%2F1",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: {
        Authorization: "Bearer id-token",
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      status: "approved",
    });
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
