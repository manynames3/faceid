import type { WorkspaceClient } from "./client";
import {
  countPendingDecisions,
  emptyLibrary,
  libraryReducer,
  type LibraryAction,
  type LibraryState,
} from "./library";
import { createSampleData } from "./mockData";
import { simulateUpload } from "./simulate";
import type { EventWorkspace, LibraryResult } from "./types";

type EventData = Pick<LibraryState, "people" | "photos">;

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
}

/**
 * In-memory stand-in for the service. It holds every sample event's data, so
 * switching events never loses sample work, and it makes no network requests
 * of any kind. Nothing is written to storage.
 */
export function createDemoClient(): WorkspaceClient {
  let events: EventWorkspace[] = [];
  let data = new Map<string, EventData>();

  function seed() {
    const sample = createSampleData();
    events = [sample.event];
    data = new Map([[sample.event.id, { people: sample.people, photos: sample.photos }]]);
  }
  seed();

  function eventWithCounts(event: EventWorkspace): EventWorkspace {
    const content = data.get(event.id) ?? { people: [], photos: [] };
    return {
      ...event,
      guestCount: content.people.length,
      photoCount: content.photos.length,
      reviewCount: countPendingDecisions(content.photos),
    };
  }

  function contentFor(eventId: string): EventData {
    const content = data.get(eventId);
    if (!content) {
      throw new Error("That sample event doesn't exist.");
    }
    return content;
  }

  /** Reuse the real reducer so the sample behaves exactly like fetched data. */
  function apply(eventId: string, action: LibraryAction) {
    const content = contentFor(eventId);
    const next = libraryReducer(
      { ...emptyLibrary, ...content, eventId, status: "ready" },
      action,
    );
    data.set(eventId, { people: next.people, photos: next.photos });
  }

  return {
    mode: "demo",

    async assignGuest(eventId, photoId, personId) {
      const content = contentFor(eventId);
      const photo = content.photos.find(item => item.id === photoId);
      const person = content.people.find(item => item.id === personId);
      if (!photo || !person) throw new Error("That photo or guest no longer exists.");
      if (person.consentStatus !== "captured") throw new Error("Record this guest's permission first.");
      const existing = photo.matches.find(match => match.personId === personId);
      if (existing?.status === "approved") return existing;
      const match = { personId, personName: person.name, status: "approved" as const, source: "manual" as const, reviewedAt: new Date().toISOString() };
      apply(eventId, { type: "match-updated", eventId, photoId, match });
      return match;
    },

    async rematchGuest(eventId, photoId, personId) {
      const content = contentFor(eventId);
      const photo = content.photos.find(item => item.id === photoId);
      const person = content.people.find(item => item.id === personId);
      if (!photo || !person) throw new Error("That photo or guest no longer exists.");
      if (person.consentStatus !== "captured") throw new Error("Record this guest's permission first.");
      const existing = photo.matches.find(match => match.personId === personId);
      if (existing?.status === "approved" || existing?.status === "rejected") return { match: existing, outcome: "kept_decision" };
      // Only seeded relationships suggest matches; arbitrary sample photos aren't analysed.
      if (!existing) return { match: null, outcome: "no_new_match" };
      const match = existing;
      apply(eventId, { type: "match-updated", eventId, photoId, match });
      return { match, outcome: "suggested" };
    },

    async updateEvent(eventId, settings) {
      const event = events.find((item) => item.id === eventId);
      if (!event) throw new Error("That sample event doesn't exist.");
      Object.assign(event, settings);
      return eventWithCounts(event);
    },

    async downloadPhoto(eventId, photoId) {
      const photo = contentFor(eventId).photos.find((item) => item.id === photoId);
      if (!photo) throw new Error("That photo no longer exists.");
      return { url: photo.previewUrl, filename: photo.name };
    },

    async fetchEvents() {
      return events.map(eventWithCounts);
    },

    async createEvent(name) {
      const event: EventWorkspace = {
        id: `event-sample-${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`,
        name,
        createdAt: new Date().toISOString(),
        status: "active",
      };
      events = [event, ...events];
      data.set(event.id, { people: [], photos: [] });
      return eventWithCounts(event);
    },

    async fetchLibrary(eventId): Promise<LibraryResult> {
      const content = contentFor(eventId);
      const event = events.find((item) => item.id === eventId);
      return {
        event: event ? eventWithCounts(event) : undefined,
        events: events.map(eventWithCounts),
        people: [...content.people],
        photos: [...content.photos],
      };
    },

    async submitUpload({ eventId, files, guestName, mode, personId }) {
      const result = await simulateUpload({
        files,
        guestName,
        mode,
        people: contentFor(eventId).people,
        personId,
      });
      apply(eventId, { type: "merge-upload", eventId, result });
      return result;
    },

    async updateMatchStatus({ eventId, personId, photoId, status }) {
      const photo = contentFor(eventId).photos.find((item) => item.id === photoId);
      const existing = photo?.matches.find((match) => match.personId === personId);
      if (!existing) {
        throw new Error("That match no longer exists.");
      }
      const match = { ...existing, status, reviewedAt: new Date().toISOString() };
      apply(eventId, { type: "match-updated", eventId, photoId, match });
      return match;
    },

    async deletePhoto(eventId, photoId) {
      const photo = contentFor(eventId).photos.find((item) => item.id === photoId);
      if (photo?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(photo.previewUrl);
      }
      apply(eventId, { type: "photo-removed", eventId, photoId });
    },

    async deletePerson(eventId, personId) {
      const person = contentFor(eventId).people.find((item) => item.id === personId);
      if (person?.referencePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(person.referencePreviewUrl);
      }
      apply(eventId, { type: "person-removed", eventId, personId });
    },

    reset() {
      seed();
    },
  };
}
