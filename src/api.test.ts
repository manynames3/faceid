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
  it("authenticates event settings and original-photo download requests", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const settings = { name: "Dinner", hostName: "Studio", contactEmail: "hello@example.com", signupOpen: false };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ event: { id: "event 1", ...settings } })).mockResolvedValueOnce(jsonResponse({ url: "https://s3.example.test/original", filename: "event.jpg" }));
    vi.stubGlobal("fetch", fetchMock);
    const { updateEvent, fetchPhotoDownload } = await import("./api");
    expect(await updateEvent("event 1", settings, authSession)).toMatchObject(settings);
    expect(await fetchPhotoDownload("photo/1", authSession)).toMatchObject({ filename: "event.jpg" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/events/event%201");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", headers: { Authorization: "Bearer id-token" } });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.test/photos/photo%2F1/download");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer id-token");
  });
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

describe("reference uploads", () => {
  it("sends an explicit guest name and person id in the presign and process requests", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          uploads: [
            {
              headers: { "Content-Type": "image/png" },
              key: "users/user-1/references/ref.png",
              name: "ref.png",
              uploadId: "upload-9",
              url: "https://s3.example.test/ref",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          people: [
            { id: "person-1", initials: "李", name: "李小龍", photoCount: 0, referenceCount: 2 },
          ],
          photos: [],
          warnings: ["second.jpg had no usable face."],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { submitUpload } = await import("./api");
    const result = await submitUpload({
      consentConfirmed: true,
      eventId: "event-1",
      files: [new File(["x"], "ref.png", { type: "image/png" })],
      guestName: "李小龍",
      mode: "references",
      people: [],
      personId: "person-1",
      session: authSession,
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      guestName: "李小龍",
      personId: "person-1",
    });
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toMatchObject({
      consent: { confirmed: true, source: "owner_attested" },
      guestName: "李小龍",
      personId: "person-1",
    });
    expect(result.people[0].referenceCount).toBe(2);
    expect(result.warnings).toEqual(["second.jpg had no usable face."]);
  });

  it("never makes a network request in sample mode, even when an API is configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitUpload } = await import("./api");
    const result = await submitUpload({
      demo: true,
      eventId: "event-sample",
      files: [new File(["x"], "ref.jpg", { type: "image/jpeg" })],
      guestName: "Sample Guest",
      mode: "references",
      people: [],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.people[0]).toMatchObject({ name: "Sample Guest", referenceCount: 1 });
  });
});

describe("error mapping", () => {
  async function failWith(response: Response | Error) {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      ),
    );
    const { ApiError, fetchEvents } = await import("./api");
    const error = await fetchEvents(authSession).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    return error as InstanceType<typeof ApiError>;
  }

  it("turns 401 into a session-expired error", async () => {
    const error = await failWith(new Response("{}", { status: 401 }));
    expect(error.kind).toBe("session_expired");
    expect(error.status).toBe(401);
  });

  it("surfaces the server's message on a 400", async () => {
    const error = await failWith(
      new Response(JSON.stringify({ message: "Event name is required." }), { status: 400 }),
    );
    expect(error.kind).toBe("validation");
    expect(error.message).toBe("Event name is required.");
  });

  it("gives a wait-and-retry message for 429 and a plain one for 5xx", async () => {
    expect((await failWith(new Response("", { status: 429 }))).kind).toBe("rate_limited");
    const server = await failWith(new Response("<html>oops</html>", { status: 503 }));
    expect(server.kind).toBe("server");
    expect(server.message).not.toContain("<html>");
  });

  it("reports a dropped connection as a network error with status 0", async () => {
    const error = await failWith(new TypeError("Failed to fetch"));
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
  });

  it("marks a timed-out processing step as uncertain", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            uploads: [
              { headers: {}, key: "users/u/photos/p.jpg", name: "p.jpg", uploadId: "u1", url: "https://s3.example.test/p" },
            ],
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response("{}", { status: 504 })),
    );

    const { ApiError, submitUpload } = await import("./api");
    const error = await submitUpload({
      eventId: "event-1",
      files: [new File(["x"], "p.jpg", { type: "image/jpeg" })],
      mode: "photos",
      people: [],
      session: authSession,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).uncertain).toBe(true);
  });
});

describe("guest intake", () => {
  it("keeps gallery reads and downloads public-capability-only, and owner link controls authenticated", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ photos: [], guestName: "Guest" }))
      .mockResolvedValueOnce(jsonResponse({ url: "signed", filename: "photo.jpg" }))
      .mockResolvedValueOnce(jsonResponse({ galleryUrl: "private", person: { id: "person 1" } }))
      .mockResolvedValueOnce(jsonResponse({ person: { id: "person 1", galleryEnabled: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGuestGallery, fetchGalleryDownload, createGalleryLink, disableGalleryLink } = await import("./api");
    await fetchGuestGallery("person 1", "private-token");
    await fetchGalleryDownload("person 1", "private-token", "photo/1");
    await createGalleryLink("person 1", authSession, "photo/1");
    await disableGalleryLink("person 1", authSession);
    for (const index of [0, 1]) expect(fetchMock.mock.calls[index][1].headers).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toContain("/guest-gallery/photos/photo%2F1/download?");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer id-token" } });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ photoId: "photo/1" });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "DELETE", headers: { Authorization: "Bearer id-token" } });
  });
  it("sends the same rematch request ID on retry and authenticates manual assignment", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ match: { source: "manual", status: "approved" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 504 }))
      .mockResolvedValueOnce(jsonResponse({ match: null, outcome: "no_new_match" }));
    vi.stubGlobal("fetch", fetchMock);
    const { assignPhotoGuest, rematchPhotoGuest } = await import("./api");
    await assignPhotoGuest("event-1", "photo 1", "person-1", authSession);
    await expect(rematchPhotoGuest("event-1", "photo 1", "person-1", "stable-request", authSession)).rejects.toMatchObject({ uncertain: true });
    await rematchPhotoGuest("event-1", "photo 1", "person-1", "stable-request", authSession);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ requestId: "stable-request", eventId: "event-1", personId: "person-1" });
    for (const call of fetchMock.mock.calls) expect(call[1].headers.Authorization).toBe("Bearer id-token");
  });
  it("checks guest receipts without an owner token or another processing request", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "saved", name: "Guest", referenceCount: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGuestSubmission } = await import("./api");
    expect(await fetchGuestSubmission("event-1", "invitation-token", ["upload-1"])).toMatchObject({ status: "saved", referenceCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/guest-intake/status");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ eventId: "event-1", token: "invitation-token", uploadIds: ["upload-1"] });
  });
  it("records an uploaded guest receipt before an uncertain processing response", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const onReceipt = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ uploads: [{ name: "ref.jpg", uploadId: "guest-upload", key: "users/owner/references/ref.jpg", url: "https://s3.example.test/ref", headers: {} }] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(() => { expect(onReceipt).toHaveBeenCalledWith(["guest-upload"]); return Promise.resolve(new Response("{}", { status: 504 })); });
    vi.stubGlobal("fetch", fetchMock);
    const { submitUpload } = await import("./api");
    await expect(submitUpload({ eventId: "event-1", intakeToken: "invite", guestName: "Guest", files: [new File(["x"], "ref.jpg", { type: "image/jpeg" })], mode: "references", people: [], consentConfirmed: true, onReceipt })).rejects.toMatchObject({ uncertain: true });
    expect(onReceipt).toHaveBeenCalledTimes(1);
  });
  it("requests owner links with auth and guest metadata without it", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({eventId: "event-1", eventName: "Dinner", intakeUrl: "https://site.example.test/guest"}));
    vi.stubGlobal("fetch", fetchMock);
    const {fetchIntakeLink, fetchGuestIntake} = await import("./api");
    await fetchIntakeLink("event-1", authSession);
    await fetchGuestIntake("event-1", "test-token");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/events/event-1/intake-link");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer id-token");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.test/guest-intake?eventId=event-1&token=test-token");
    expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
  });

  it("uses reference-only guest endpoints, records guest consent and never sends the host token", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({uploads: [{name: "p.jpg", uploadId: "u1", key: "users/owner/references/p.jpg", url: "https://s3.example.test/p", headers: {"Content-Type": "image/jpeg"}}]}))
      .mockResolvedValueOnce(new Response(null, {status: 200}))
      .mockResolvedValueOnce(jsonResponse({people: [{id: "person-1", name: "Guest", referenceCount: 1}], photos: []}));
    vi.stubGlobal("fetch", fetchMock);
    const {submitUpload} = await import("./api");
    await submitUpload({eventId: "event-1", intakeToken: "test-token", guestName: "Guest", files: [new File(["x"], "p.jpg", {type: "image/jpeg"})], mode: "references", people: [], consentConfirmed: true, session: authSession});
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/guest-intake/presign");
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.example.test/guest-intake/process");
    for (const index of [0, 2]) {
      expect(fetchMock.mock.calls[index][1].headers.Authorization).toBeUndefined();
      const body = JSON.parse(fetchMock.mock.calls[index][1].body);
      expect(body.token).toBe("test-token");
      expect(body.guestName).toBe("Guest");
    }
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).consent).toEqual({confirmed: true, source: "guest_submitted"});
  });

  it("refuses event-photo processing or adding to another profile through a guest link", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const {submitUpload} = await import("./api");
    const common = {eventId: "event-1", intakeToken: "test-token", guestName: "Guest", files: [], people: []};
    await expect(submitUpload({...common, mode: "photos"})).rejects.toThrow("Guest signup needs");
    await expect(submitUpload({...common, mode: "references", personId: "existing-guest"})).rejects.toThrow("Guest signup needs");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
