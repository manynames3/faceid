import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { WorkspaceClient } from "./client";
import { ApiError, errorMessage, isAbortError, isSessionExpired } from "./errors";
import {
  emptyLibrary,
  libraryReducer,
  matchKey,
  type LibraryState,
  type ReviewEntry,
} from "./library";
import type { DecisionStatus, EventWorkspace, LibraryResult, Person, PhotoAsset } from "./types";
import {
  chunkFiles,
  describePhotoResult,
  MAX_REFERENCE_FILES,
  PHOTOS_PER_REQUEST,
  isRetryableUpload,
  runUploadChunks,
  summarizeUploads,
  validateImageFiles,
  type RejectedFile,
  type UploadStatus,
} from "./uploads";

export type Notice = {
  action?: { label: string; run: () => void };
  id: number;
  text: string;
  tone: "success" | "error" | "info";
};

export type QueueItem = {
  file: File;
  id: string;
  matchCount?: number;
  message?: string;
  name: string;
  size: number;
  status: UploadStatus;
};

export type AddGuestInput = {
  files: File[];
  name: string;
  personId?: string;
};

const noticeLifetimeMs = 9000;

/**
 * All workspace state and actions. Every async step remembers which event it
 * was started for and drops its result if the user is somewhere else by then.
 */
export function useWorkspace({
  client,
  onSessionExpired,
}: {
  client: WorkspaceClient;
  onSessionExpired: () => void;
}) {
  const [events, setEvents] = useState<EventWorkspace[]>([]);
  const [eventsState, setEventsState] = useState<{
    error: string | null;
    status: "loading" | "ready" | "error";
  }>({ error: null, status: "loading" });
  const [activeEventId, setActiveEventId] = useState("");
  const [library, dispatch] = useReducer(libraryReducer, emptyLibrary);
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const [pendingOps, setPendingOps] = useState(0);
  const [reviewingKeys, setReviewingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedFile[]>([]);

  const activeEventRef = useRef("");
  const libraryRef = useRef<LibraryState>(library);
  const loadControllerRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const noticeCounter = useRef(0);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      loadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!notice || notice.tone === "error") {
      return;
    }
    const timer = window.setTimeout(() => setNoticeState(null), noticeLifetimeMs);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const notify = useCallback((tone: Notice["tone"], text: string, action?: Notice["action"]) => {
    noticeCounter.current += 1;
    setNoticeState({ action, id: noticeCounter.current, text, tone });
  }, []);

  /** Only speak for an event the user is still looking at. */
  const notifyFor = useCallback(
    (eventId: string, tone: Notice["tone"], text: string, action?: Notice["action"]) => {
      if (aliveRef.current && activeEventRef.current === eventId) {
        notify(tone, text, action);
      }
    },
    [notify],
  );

  const loadLibrary = useCallback(
    async (eventId: string): Promise<LibraryResult | null> => {
      loadControllerRef.current?.abort();
      const controller = new AbortController();
      loadControllerRef.current = controller;
      dispatch({ type: "load-start", eventId });

      try {
        const result = await client.fetchLibrary(eventId, controller.signal);
        if (controller.signal.aborted) {
          return null;
        }
        dispatch({ type: "loaded", eventId, people: result.people, photos: result.photos });
        if (result.events) {
          setEvents(result.events);
        }
        return result;
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          return null;
        }
        if (isSessionExpired(error)) {
          onSessionExpired();
          return null;
        }
        dispatch({
          type: "load-failed",
          eventId,
          message: errorMessage(error, "This event couldn't be loaded."),
        });
        return null;
      }
    },
    [client, onSessionExpired],
  );

  const loadEvents = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const list = await client.fetchEvents(signal);
        if (signal?.aborted) {
          return;
        }
        setEvents(list);
        setEventsState({ error: null, status: "ready" });
        const first = list[0];
        if (first) {
          activeEventRef.current = first.id;
          setActiveEventId(first.id);
          void loadLibrary(first.id);
        }
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          return;
        }
        if (isSessionExpired(error)) {
          onSessionExpired();
          return;
        }
        setEventsState({
          error: errorMessage(error, "Your events couldn't be loaded."),
          status: "error",
        });
      }
    },
    [client, loadLibrary, onSessionExpired],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadEvents(controller.signal);
      }
    });
    return () => controller.abort();
  }, [loadEvents]);

  const isBusy = pendingOps > 0;

  function beginOperation() {
    setPendingOps((count) => count + 1);
  }

  function endOperation() {
    setPendingOps((count) => Math.max(0, count - 1));
  }

  /** Explains a failed change; refreshes first when the service may have applied it anyway. */
  async function handleFailure(error: unknown, eventId: string, fallback: string) {
    if (isAbortError(error)) {
      return;
    }
    if (isSessionExpired(error)) {
      onSessionExpired();
      return;
    }

    const mayHaveApplied =
      error instanceof ApiError &&
      (error.kind === "network" || error.kind === "server") &&
      error.stage !== "upload" &&
      error.stage !== "presign";

    if (mayHaveApplied && activeEventRef.current === eventId) {
      await loadLibrary(eventId);
      notifyFor(
        eventId,
        "error",
        `${errorMessage(error, fallback)} The list was refreshed, so check it before trying again.`,
      );
      return;
    }

    notifyFor(eventId, "error", errorMessage(error, fallback));
  }

  function resetEventScopedState() {
    setQueue([]);
    setRejectedFiles([]);
    setNoticeState(null);
  }

  function selectEvent(eventId: string) {
    if (isBusy || eventId === activeEventRef.current) {
      return;
    }
    activeEventRef.current = eventId;
    setActiveEventId(eventId);
    resetEventScopedState();
    void loadLibrary(eventId);
  }

  async function createEvent(rawName: string) {
    const name = rawName.replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 80) {
      notify("error", "Event names need 2 to 80 characters.");
      return false;
    }
    if (isBusy) {
      return false;
    }

    beginOperation();
    try {
      const event = await client.createEvent(name);
      if (!aliveRef.current) {
        return false;
      }
      setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)]);
      setEventsState({ error: null, status: "ready" });
      activeEventRef.current = event.id;
      setActiveEventId(event.id);
      resetEventScopedState();
      dispatch({ type: "load-start", eventId: event.id });
      dispatch({ type: "loaded", eventId: event.id, people: [], photos: [] });
      notify("success", `${event.name} is ready. Add your first guest to begin.`);
      return true;
    } catch (error) {
      await handleFailure(error, activeEventRef.current, "The event couldn't be created.");
      return false;
    } finally {
      endOperation();
    }
  }

  function refresh() {
    const eventId = activeEventRef.current;
    if (eventId) {
      void loadLibrary(eventId);
    }
  }

  function retryEvents() {
    setEventsState({ error: null, status: "loading" });
    void loadEvents();
  }

  async function reviewMatch(entry: ReviewEntry, status: DecisionStatus) {
    const eventId = activeEventRef.current;
    const key = matchKey(entry.photo.id, entry.match.personId);
    if (!eventId || reviewingKeys.has(key)) {
      return;
    }

    beginOperation();
    setReviewingKeys((current) => new Set(current).add(key));
    try {
      const saved = await client.updateMatchStatus({
        eventId,
        personId: entry.match.personId,
        photoId: entry.photo.id,
        status,
      });
      dispatch({
        type: "match-updated",
        eventId,
        photoId: entry.photo.id,
        match: {
          ...entry.match,
          ...saved,
          reviewedAt: saved.reviewedAt || new Date().toISOString(),
        },
      });
      notifyFor(
        eventId,
        "success",
        `${status === "approved" ? "Approved" : "Rejected"} ${entry.match.personName} in ${entry.photo.name}.`,
      );
    } catch (error) {
      await handleFailure(error, eventId, "That decision couldn't be saved.");
    } finally {
      endOperation();
      setReviewingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function deleteGuest(person: Person) {
    const eventId = activeEventRef.current;
    if (!eventId || isBusy) {
      return;
    }

    beginOperation();
    try {
      await client.deletePerson(eventId, person.id);
      dispatch({ type: "person-removed", eventId, personId: person.id });
      notifyFor(eventId, "success", `${person.name} and their reference photos were deleted.`);
    } catch (error) {
      await handleFailure(error, eventId, `${person.name} couldn't be deleted.`);
    } finally {
      endOperation();
    }
  }

  async function deletePhoto(photo: PhotoAsset) {
    const eventId = activeEventRef.current;
    if (!eventId || isBusy) {
      return;
    }

    beginOperation();
    try {
      await client.deletePhoto(eventId, photo.id);
      dispatch({ type: "photo-removed", eventId, photoId: photo.id });
      notifyFor(eventId, "success", `${photo.name} was deleted.`);
    } catch (error) {
      await handleFailure(error, eventId, `${photo.name} couldn't be deleted.`);
    } finally {
      endOperation();
    }
  }

  async function addGuest({ files, name, personId }: AddGuestInput): Promise<boolean> {
    const eventId = activeEventRef.current;
    if (!eventId || isBusy) {
      return false;
    }

    const guestName = name.replace(/\s+/g, " ").trim();
    const existing = personId
      ? libraryRef.current.people.find((person) => person.id === personId)
      : undefined;
    if (!existing && (guestName.length < 1 || guestName.length > 80)) {
      notify("error", "Enter the guest's name (up to 80 characters).");
      return false;
    }
    if (files.length < 1 || files.length > MAX_REFERENCE_FILES) {
      notify("error", `Choose 1 or ${MAX_REFERENCE_FILES} reference photos.`);
      return false;
    }

    const label = existing?.name ?? guestName;
    beginOperation();
    try {
      const result = await client.submitUpload({
        consentConfirmed: true,
        eventId,
        files,
        guestName: existing ? undefined : guestName,
        mode: "references",
        people: libraryRef.current.people,
        personId: existing?.id,
      });
      if (!aliveRef.current || activeEventRef.current !== eventId) {
        return false;
      }

      dispatch({ type: "merge-upload", eventId, result });

      const saved = result.people.find((person) => (existing ? person.id === existing.id : true));
      const addedNothing =
        !saved || (existing !== undefined && saved.referenceCount <= existing.referenceCount);
      const warnings = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";

      if (addedNothing) {
        notify(
          "error",
          `No usable face was found, so nothing was added for ${label}. Try a clearer, front-facing photo.${warnings}`,
        );
        return false;
      }

      const referenceCount = saved?.referenceCount ?? files.length;
      notify(
        "success",
        existing
          ? `Added references for ${label}. Photos you already uploaded are not re-checked against them.${warnings}`
          : `${label} was added with ${referenceCount} reference photo${referenceCount === 1 ? "" : "s"}. Upload event photos to start matching.${warnings}`,
      );
      return true;
    } catch (error) {
      await handleFailure(error, eventId, `${label} couldn't be added.`);
      return false;
    } finally {
      endOperation();
    }
  }

  function updateQueueItem(id: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function runQueue(items: QueueItem[], eventId: string) {
    const knownIds = new Set(libraryRef.current.photos.map((photo) => photo.id));
    const stillHere = () => aliveRef.current && activeEventRef.current === eventId;
    const uncertain: QueueItem[] = [];
    const statuses = new Map(items.map((item) => [item.id, "queued" as UploadStatus]));
    function trackItem(id: string, patch: Partial<QueueItem>) {
      if (patch.status) {
        statuses.set(id, patch.status);
      }
      updateQueueItem(id, patch);
    }

    beginOperation();
    try {
      const outcomes = await runUploadChunks(
        chunkFiles(items, PHOTOS_PER_REQUEST),
        ([item]) =>
          client.submitUpload({
            consentConfirmed: false,
            eventId,
            files: [item.file],
            mode: "photos",
            people: libraryRef.current.people,
          }),
        {
          onStart: ([item]) => trackItem(item.id, { message: undefined, status: "sending" }),
          onDone: ([item], result) => {
            const photo = result.photos[0];
            if (!photo) {
              uncertain.push(item);
              trackItem(item.id, {
                message: "The service finished without returning this photo. Refreshing to check.",
                status: "uncertain",
              });
              return;
            }
            dispatch({ type: "merge-upload", eventId, result });
            trackItem(item.id, {
              matchCount: photo.matches.length,
              message: describePhotoResult(photo.matches.length),
              status: "done",
            });
          },
          onFailed: ([item], error) => {
            if (isSessionExpired(error)) {
              onSessionExpired();
            }
            const isUncertain = error instanceof ApiError && error.uncertain;
            if (isUncertain) {
              uncertain.push(item);
            }
            trackItem(item.id, {
              message: errorMessage(error, "The upload failed."),
              status: isUncertain ? "uncertain" : "failed",
            });
          },
          shouldContinue: stillHere,
        },
      );

      for (const outcome of outcomes) {
        if (outcome.status === "skipped") {
          trackItem(outcome.chunk[0].id, {
            message: "Not sent. Try again when you're ready.",
            status: "skipped",
          });
        }
      }

      // After a timeout the photo may have been saved anyway: refresh first so
      // anything that did land is visible before the user retries.
      if (uncertain.length > 0 && stillHere()) {
        const refreshed = await loadLibrary(eventId);
        if (refreshed) {
          const newPhotos = refreshed.photos.filter((photo) => !knownIds.has(photo.id));
          for (const item of uncertain) {
            const candidates = newPhotos.filter((photo) => photo.name === item.name && photo.size === item.size);
            const found = candidates.length === 1 ? candidates[0] : undefined;
            if (found) {
              newPhotos.splice(newPhotos.indexOf(found), 1);
              trackItem(item.id, {
                matchCount: found.matches.length,
                message: `A matching file appeared after refresh. Inspect it before delivery. ${describePhotoResult(found.matches.length)}`,
                status: "done",
              });
            } else {
              trackItem(item.id, {
                message:
                  "Not confirmed. It may still be processing; refresh in a minute before retrying.",
                status: "uncertain",
              });
            }
          }
        }
      }

      const { saved, total, attention: failed } = summarizeUploads(statuses.values());
      notifyFor(
        eventId,
        failed === 0 ? "success" : saved === 0 ? "error" : "info",
        failed === 0
          ? `${saved} photo${saved === 1 ? "" : "s"} uploaded. Review the suggested matches next.`
          : `${saved} of ${total} photos uploaded. ${failed} need attention below.`,
      );
    } finally {
      endOperation();
    }
  }

  function uploadPhotos(files: File[]) {
    const eventId = activeEventRef.current;
    if (!eventId || isBusy) {
      return;
    }
    if (libraryRef.current.people.length === 0) {
      notify("error", "Add at least one guest with reference photos first, or nothing can match.");
      return;
    }

    const { accepted, rejected } = validateImageFiles(files);
    setRejectedFiles(rejected);
    if (accepted.length === 0) {
      notify(
        "error",
        files.length === 0
          ? "No files were selected."
          : "None of the selected files could be uploaded. See the list below.",
      );
      return;
    }
    setNoticeState(null);

    const items = accepted.map(
      (file): QueueItem => ({
        file,
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        status: "queued",
      }),
    );
    setQueue(items);
    void runQueue(items, eventId);
  }

  function retryFailedUploads() {
    const eventId = activeEventRef.current;
    if (!eventId || isBusy) {
      return;
    }
    const retryable = queue.filter((item) => isRetryableUpload(item.status));
    if (retryable.length === 0) {
      return;
    }
    setQueue((current) =>
      current.map((item) =>
        retryable.some((entry) => entry.id === item.id)
          ? { ...item, message: undefined, status: "queued" }
          : item,
      ),
    );
    void runQueue(retryable, eventId);
  }

  function dismissQueue() {
    if (!isBusy) {
      setQueue([]);
    }
  }

  function resetSample() {
    if (!client.reset || isBusy) {
      return;
    }
    client.reset();
    activeEventRef.current = "";
    setActiveEventId("");
    dispatch({ type: "clear" });
    resetEventScopedState();
    setEventsState({ error: null, status: "loading" });
    void loadEvents();
    notify("info", "Sample workspace reset to its starting state.");
  }

  return {
    activeEventId,
    addGuest,
    createEvent,
    deleteGuest,
    deletePhoto,
    dismissNotice: () => setNoticeState(null),
    dismissQueue,
    events,
    eventsState,
    isBusy,
    library,
    notice,
    queue,
    refresh,
    rejectedFiles,
    resetSample,
    retryEvents,
    retryFailedUploads,
    reviewMatch,
    reviewingKeys,
    selectEvent,
    setRejectedFiles,
    uploadPhotos,
  };
}
