import type { AuthSession } from "./auth";
import {
  ApiError,
  apiErrorFromStatus,
  isAbortError,
  networkError,
  type ApiStage,
} from "./errors";
import { normalizePhoto } from "./library";
import { simulateUpload } from "./simulate";
import type {
  DecisionStatus,
  EventWorkspace,
  LibraryResult,
  Person,
  PhotoMatch,
  UploadMode,
  UploadResult,
} from "./types";

export { ApiError } from "./errors";

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const apiBaseUrl = rawApiBaseUrl?.replace(/\/$/, "");

export type UploadPayload = {
  consentConfirmed?: boolean;
  /** Sample workspace: simulate locally and never make a network request. */
  demo?: boolean;
  eventId?: string;
  files: File[];
  /** Name for a new guest (references only). */
  guestName?: string;
  /** Event-scoped guest signup capability; never an AWS credential. */
  intakeToken?: string;
  mode: UploadMode;
  people: Person[];
  /** Add references to an existing guest instead of creating one (references only). */
  personId?: string;
  session?: AuthSession | null;
};

export const hasConfiguredApi = Boolean(apiBaseUrl);

export type GuestIntake = { eventId: string; eventName: string };
export type IntakeLink = GuestIntake & { intakeUrl: string };

type PresignResponse = {
  uploads: Array<{
    name: string;
    uploadId: string;
    key: string;
    url: string;
    headers: Record<string, string>;
  }>;
};

type UploadedFile = {
  name: string;
  uploadId: string;
  key: string;
  size: number;
  type: string;
};

function requireApi() {
  if (!apiBaseUrl) {
    throw new Error("The live service isn't configured for this build.");
  }
  return apiBaseUrl;
}

async function request(url: string, init: RequestInit, stage: ApiStage = "request") {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw networkError(stage);
  }

  if (!response.ok) {
    let message: unknown;
    try {
      message = ((await response.json()) as { message?: unknown }).message;
    } catch {
      message = undefined;
    }
    throw apiErrorFromStatus(response.status, message, stage);
  }

  return response;
}

async function readJson<T>(response: Response, stage: ApiStage = "request"): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      kind: "server",
      message: "The service sent a reply we couldn't read. Refresh and try again.",
      stage,
      status: response.status,
    });
  }
}

export async function fetchEvents(
  session?: AuthSession | null,
  signal?: AbortSignal,
): Promise<EventWorkspace[]> {
  const response = await request(`${requireApi()}/events`, {
    headers: authHeaders(session),
    signal,
  });
  const result = await readJson<{ events?: EventWorkspace[] }>(response);
  return result.events ?? [];
}

export async function createEvent(
  name: string,
  session?: AuthSession | null,
): Promise<EventWorkspace> {
  const response = await request(`${requireApi()}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({ name }),
  });
  const result = await readJson<{ event: EventWorkspace }>(response);
  return result.event;
}

export async function fetchIntakeLink(eventId: string, session: AuthSession): Promise<IntakeLink> {
  const response = await request(`${requireApi()}/events/${encodeURIComponent(eventId)}/intake-link`, {
    headers: authHeaders(session),
  });
  return readJson<IntakeLink>(response);
}

export async function fetchGuestIntake(eventId: string, token: string, signal?: AbortSignal): Promise<GuestIntake> {
  const params = new URLSearchParams({ eventId, token });
  const response = await request(`${requireApi()}/guest-intake?${params}`, { signal });
  return readJson<GuestIntake>(response);
}

export async function fetchLibrary(
  eventId?: string,
  session?: AuthSession | null,
  signal?: AbortSignal,
): Promise<LibraryResult> {
  const url = new URL(`${requireApi()}/library`);
  if (eventId) {
    url.searchParams.set("eventId", eventId);
  }

  const response = await request(url.toString(), {
    headers: authHeaders(session),
    signal,
  });
  const result = await readJson<Partial<LibraryResult>>(response);
  return {
    ...result,
    people: result.people ?? [],
    photos: (result.photos ?? []).map(normalizePhoto),
  };
}

export async function deletePhoto(photoId: string, session?: AuthSession | null) {
  await request(`${requireApi()}/photos/${encodeURIComponent(photoId)}`, {
    headers: authHeaders(session),
    method: "DELETE",
  });
}

export async function deletePerson(personId: string, session?: AuthSession | null) {
  await request(`${requireApi()}/people/${encodeURIComponent(personId)}`, {
    headers: authHeaders(session),
    method: "DELETE",
  });
}

export async function updateMatchStatus({
  photoId,
  personId,
  session,
  status,
}: {
  photoId: string;
  personId: string;
  session?: AuthSession | null;
  status: DecisionStatus;
}): Promise<PhotoMatch | null> {
  const response = await request(
    `${requireApi()}/matches/${encodeURIComponent(photoId)}/${encodeURIComponent(personId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(session) },
      body: JSON.stringify({ status }),
    },
  );

  const result = await readJson<{ match?: PhotoMatch }>(response);
  return result.match ?? null;
}

/**
 * Uploads one request's worth of files and returns the service's snapshot.
 * Callers decide the batch size (one event photo per request; up to two
 * references per request).
 */
export async function submitUpload({
  consentConfirmed,
  demo,
  eventId,
  files,
  guestName,
  intakeToken,
  mode,
  people,
  personId,
  session,
}: UploadPayload): Promise<UploadResult> {
  if (demo) {
    return simulateUpload({ files, guestName, mode, people, personId });
  }

  const base = requireApi();
  const isGuest = intakeToken !== undefined;
  if (isGuest && (mode !== "references" || !guestName || !eventId || !intakeToken || personId)) {
    throw new Error("Guest signup needs an event link, a name and new reference photos.");
  }
  const uploadPath = isGuest ? "guest-intake" : "uploads";
  const guestFields =
    mode === "references"
      ? {
          guestName: guestName || undefined,
          personId: personId || undefined,
        }
      : {};

  const presignResponse = await request(
    `${base}/${uploadPath}/presign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(isGuest ? null : session) },
      body: JSON.stringify({
        token: intakeToken,
        eventId,
        mode,
        ...guestFields,
        files: files.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
        })),
      }),
    },
    "presign",
  );

  const { uploads } = await readJson<PresignResponse>(presignResponse, "presign");
  const uploadedFiles: UploadedFile[] = [];

  for (const [index, file] of files.entries()) {
    const upload = uploads[index];
    if (!upload) {
      throw new ApiError({
        kind: "server",
        message: `The service didn't return an upload slot for ${file.name}. Try again.`,
        stage: "presign",
        status: 200,
      });
    }

    let putResponse: Response;
    try {
      putResponse = await fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: file,
      });
    } catch {
      throw networkError("upload");
    }

    if (!putResponse.ok) {
      throw new ApiError({
        kind: putResponse.status >= 500 ? "server" : "unknown",
        message: `Couldn't upload ${file.name} to storage (status ${putResponse.status}). Try again.`,
        stage: "upload",
        status: putResponse.status,
      });
    }

    uploadedFiles.push({
      name: file.name,
      uploadId: upload.uploadId,
      key: upload.key,
      size: file.size,
      type: file.type || "application/octet-stream",
    });
  }

  const response = await request(
    `${base}/${uploadPath}/process`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(isGuest ? null : session) },
      body: JSON.stringify({
        token: intakeToken,
        consent:
          mode === "references"
            ? { confirmed: consentConfirmed === true, source: isGuest ? "guest_submitted" : "owner_attested" }
            : undefined,
        eventId,
        mode,
        ...guestFields,
        files: uploadedFiles,
      }),
    },
    "process",
  );

  const result = await readJson<Partial<UploadResult>>(response, "process");
  return {
    people: result.people ?? [],
    photos: (result.photos ?? []).map(normalizePhoto),
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : undefined,
  };
}

function authHeaders(session?: AuthSession | null): Record<string, string> {
  return session ? { Authorization: `Bearer ${session.idToken}` } : {};
}
