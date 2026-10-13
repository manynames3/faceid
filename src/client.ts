import {
  createEvent,
  deletePerson,
  deletePhoto,
  fetchEvents,
  fetchLibrary,
  fetchIntakeLink,
  submitUpload,
  updateMatchStatus,
  updateEvent,
  fetchPhotoDownload,
  assignPhotoGuest,
  rematchPhotoGuest,
  createGalleryLink,
  disableGalleryLink,
} from "./api";
import type { IntakeLink } from "./api";
import type { AuthSession } from "./auth";
import { ApiError } from "./errors";
import type {
  DecisionStatus,
  EventWorkspace,
  EventSettings,
  LibraryResult,
  Person,
  PhotoMatch,
  UploadMode,
  UploadResult,
  GalleryLink,
  RematchResult,
} from "./types";

export type UploadRequest = {
  consentConfirmed: boolean;
  eventId: string;
  files: File[];
  guestName?: string;
  mode: UploadMode;
  people: Person[];
  personId?: string;
};

/**
 * Everything the workspace needs from a backend. The live client talks to the
 * AWS API; the sample client (demoClient.ts) is entirely in memory, so the
 * sample workspace can never reach the network.
 */
export type WorkspaceClient = {
  assignGuest(eventId: string, photoId: string, personId: string): Promise<PhotoMatch>;
  rematchGuest(eventId: string, photoId: string, personId: string, requestId: string): Promise<RematchResult>;
  createGalleryLink?: (personId: string, photoId: string) => Promise<GalleryLink>;
  disableGalleryLink?: (personId: string) => Promise<Person>;
  createEvent(name: string): Promise<EventWorkspace>;
  updateEvent(eventId: string, settings: EventSettings): Promise<EventWorkspace>;
  downloadPhoto(eventId: string, photoId: string): Promise<{ url: string; filename: string }>;
  deletePerson(eventId: string, personId: string): Promise<void>;
  deletePhoto(eventId: string, photoId: string): Promise<void>;
  fetchEvents(signal?: AbortSignal): Promise<EventWorkspace[]>;
  fetchLibrary(eventId: string, signal?: AbortSignal): Promise<LibraryResult>;
  getIntakeLink?: (eventId: string) => Promise<IntakeLink>;
  mode: "demo" | "live";
  /** Sample workspace only: restore the original sample data. */
  reset?: () => void;
  submitUpload(request: UploadRequest): Promise<UploadResult>;
  updateMatchStatus(request: {
    eventId: string;
    personId: string;
    photoId: string;
    status: DecisionStatus;
  }): Promise<PhotoMatch>;
};

export function createLiveClient(session: AuthSession): WorkspaceClient {
  return {
    mode: "live",
    assignGuest: (eventId, photoId, personId) => assignPhotoGuest(eventId, photoId, personId, session),
    rematchGuest: (eventId, photoId, personId, requestId) => rematchPhotoGuest(eventId, photoId, personId, requestId, session),
    createGalleryLink: (personId, photoId) => createGalleryLink(personId, session, photoId),
    disableGalleryLink: (personId) => disableGalleryLink(personId, session),
    createEvent: (name) => createEvent(name, session),
    updateEvent: (eventId, settings) => updateEvent(eventId, settings, session),
    downloadPhoto: (_eventId, photoId) => fetchPhotoDownload(photoId, session),
    deletePerson: (_eventId, personId) => deletePerson(personId, session),
    deletePhoto: (_eventId, photoId) => deletePhoto(photoId, session),
    fetchEvents: (signal) => fetchEvents(session, signal),
    fetchLibrary: (eventId, signal) => fetchLibrary(eventId, session, signal),
    getIntakeLink: (eventId) => fetchIntakeLink(eventId, session),
    submitUpload: (request) => submitUpload({ ...request, demo: false, session }),
    updateMatchStatus: async ({ personId, photoId, status }) => {
      const match = await updateMatchStatus({ personId, photoId, session, status });
      if (!match) {
        throw new ApiError({
          kind: "server",
          message: "The service didn't confirm that decision. Refresh and check it.",
          status: 200,
        });
      }
      return match;
    },
  };
}
