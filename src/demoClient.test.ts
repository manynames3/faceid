import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoClient } from "./demoClient";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://service.example.test");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network call")));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("sample workspace isolation", () => {
  it("adds a missed guest without a score and keeps corrected decisions when rematching", async () => {
    const client = createDemoClient();
    const [event] = await client.fetchEvents();
    const library = await client.fetchLibrary(event.id);
    const photo = library.photos[0];
    const guest = library.people.find(person => !photo.matches.some(match => match.personId === person.id))!;
    const assigned = await client.assignGuest(event.id, photo.id, guest.id);
    expect(assigned).toMatchObject({ source: "manual", status: "approved" });
    expect(assigned.confidence).toBeUndefined();
    expect((await client.fetchLibrary(event.id)).photos[0].matches.filter(match => match.personId === guest.id)).toHaveLength(1);
    await client.updateMatchStatus({ eventId: event.id, photoId: photo.id, personId: guest.id, status: "rejected" });
    expect(await client.rematchGuest(event.id, photo.id, guest.id, "request-1")).toMatchObject({ outcome: "kept_decision", match: { status: "rejected" } });
    const differentPhoto = library.photos.find(item => item.id !== photo.id && !item.matches.some(match => match.personId === guest.id))!;
    expect(await client.rematchGuest(event.id, differentPhoto.id, guest.id, "request-no-match")).toMatchObject({ match: null, outcome: "no_new_match" });
    const other = await client.createEvent("Separate dinner");
    await expect(client.assignGuest(other.id, photo.id, guest.id)).rejects.toThrow();
    await expect(client.rematchGuest(other.id, photo.id, guest.id, "request-2")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("edits event identity and downloads local samples without reaching live services", async () => {
    const client = createDemoClient();
    const [sample] = await client.fetchEvents();
    const other = await client.createEvent("Another event");
    await client.updateEvent(sample.id, { name: "Garden dinner", hostName: "Demo studio", contactEmail: "studio@example.com", signupOpen: false });
    expect((await client.fetchEvents()).find(event => event.id === sample.id)).toMatchObject({ name: "Garden dinner", signupOpen: false });
    expect((await client.fetchEvents()).find(event => event.id === other.id)?.name).toBe("Another event");
    const photo = (await client.fetchLibrary(sample.id)).photos[0];
    expect(await client.downloadPhoto(sample.id, photo.id)).toEqual({ url: photo.previewUrl, filename: photo.name });
    await expect(client.downloadPhoto(other.id, photo.id)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps event data isolated without touching a configured live API", async () => {
    const { hasConfiguredApi } = await import("./api");
    expect(hasConfiguredApi).toBe(true);
    const client = createDemoClient();
    const [sample] = await client.fetchEvents();
    const original = await client.fetchLibrary(sample.id);
    const event = await client.createEvent("Test dinner");
    const empty = await client.fetchLibrary(event.id);

    expect(empty.people).toEqual([]);
    expect(empty.photos).toEqual([]);
    expect((await client.fetchLibrary(sample.id)).people).toEqual(original.people);
    expect((await client.fetchLibrary(sample.id)).photos).toEqual(original.photos);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("updates review counts and permits correcting decisions", async () => {
    const client = createDemoClient();
    const [sample] = await client.fetchEvents();
    const library = await client.fetchLibrary(sample.id);
    const photo = library.photos[0];
    const personId = photo.matches[0].personId;

    await client.updateMatchStatus({ eventId: sample.id, photoId: photo.id, personId, status: "approved" });
    expect((await client.fetchEvents())[0].reviewCount).toBe(2);
    expect((await client.fetchLibrary(sample.id)).photos[0].matches[0].status).toBe("approved");

    await client.updateMatchStatus({ eventId: sample.id, photoId: photo.id, personId, status: "rejected" });
    expect((await client.fetchLibrary(sample.id)).photos[0].matches[0].status).toBe("rejected");
    expect((await client.fetchEvents())[0].reviewCount).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes guest references and matches, then restores the sample on reset", async () => {
    const client = createDemoClient();
    const [sample] = await client.fetchEvents();
    const library = await client.fetchLibrary(sample.id);
    const personId = library.people[0].id;
    await client.deletePerson(sample.id, personId);
    const after = await client.fetchLibrary(sample.id);

    expect(after.people.some((person) => person.id === personId)).toBe(false);
    expect(after.photos.flatMap((photo) => photo.matches).some((match) => match.personId === personId)).toBe(false);
    expect((await client.fetchEvents())[0].guestCount).toBe(2);

    client.reset?.();
    expect((await client.fetchEvents())[0].reviewCount).toBe(3);
    expect((await client.fetchLibrary(sample.id)).people).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });
});
