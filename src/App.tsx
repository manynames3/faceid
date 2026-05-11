import {
  CheckCircle2,
  Check,
  Cloud,
  ClipboardCheck,
  Database,
  ImagePlus,
  Images,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createEvent,
  deletePerson,
  deletePhoto,
  fetchEvents,
  fetchLibrary,
  hasConfiguredApi,
  submitUpload,
  updateMatchStatus,
} from "./api";
import {
  completeSignInFromUrl,
  getStoredSession,
  hasConfiguredAuth,
  signOut,
  startSignIn,
  startSignUp,
  type AuthSession,
} from "./auth";
import { initialEvents, initialPeople, initialPhotos } from "./mockData";
import type { EventWorkspace, MatchStatus, Person, PhotoAsset, UploadMode } from "./types";

const allPeopleId = "all";
const reviewId = "needs_review";

function App() {
  const [events, setEvents] = useState<EventWorkspace[]>(
    hasConfiguredApi ? [] : initialEvents,
  );
  const [activeEventId, setActiveEventId] = useState(
    hasConfiguredApi ? "" : (initialEvents[0]?.id ?? ""),
  );
  const [people, setPeople] = useState<Person[]>(hasConfiguredApi ? [] : initialPeople);
  const [photos, setPhotos] = useState<PhotoAsset[]>(
    hasConfiguredApi ? [] : initialPhotos,
  );
  const [activePersonId, setActivePersonId] = useState(allPeopleId);
  const [query, setQuery] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() =>
    getStoredSession(),
  );
  const [isAuthLoading, setIsAuthLoading] = useState(
    hasConfiguredApi && hasConfiguredAuth,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPhotoIds, setDeletingPhotoIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deletingPersonIds, setDeletingPersonIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [reviewingMatchIds, setReviewingMatchIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState<string | null>(
    hasConfiguredApi
      ? hasConfiguredAuth
        ? "Checking sign-in."
        : "Loading AWS library."
      : null,
  );

  const activeEvent =
    events.find((event) => event.id === activeEventId) ?? events[0] ?? null;
  const eventWorkspaceName = activeEvent?.name ?? "Current Event";

  const reviewCount = photos.filter((photo) =>
    photo.matches.some((match) => isPendingReviewStatus(match.status)),
  ).length;
  const pendingDecisionCount = photos.reduce(
    (total, photo) =>
      total +
      photo.matches.filter((match) => isPendingReviewStatus(match.status)).length,
    0,
  );
  const approvedCount = photos.reduce(
    (total, photo) =>
      total + photo.matches.filter((match) => match.status === "approved").length,
    0,
  );

  useEffect(() => {
    if (!hasConfiguredAuth) {
      return;
    }

    let isCancelled = false;

    completeSignInFromUrl()
      .then((session) => {
        if (isCancelled) {
          return;
        }
        setAuthSession(session);
        if (!session) {
          setNotice(null);
        }
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        setNotice(error instanceof Error ? error.message : "Sign-in failed.");
      })
      .finally(() => {
        if (!isCancelled) {
          setIsAuthLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasConfiguredApi) {
      return;
    }
    if (hasConfiguredAuth && !authSession) {
      return;
    }

    let isCancelled = false;

    fetchEvents(authSession)
      .then((result) => {
        if (isCancelled) {
          return;
        }
        setEvents(result);
        setActiveEventId((current) => current || result[0]?.id || "");
        setNotice(null);
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        setNotice(error instanceof Error ? error.message : "Event load failed.");
      });

    return () => {
      isCancelled = true;
    };
  }, [authSession]);

  useEffect(() => {
    if (!hasConfiguredApi) {
      return;
    }
    if (hasConfiguredAuth && !authSession) {
      return;
    }
    if (!activeEventId) {
      return;
    }

    let isCancelled = false;

    fetchLibrary(activeEventId, authSession)
      .then((result) => {
        if (isCancelled) {
          return;
        }
        if (result.events) {
          setEvents(result.events);
        }
        setPeople(result.people);
        setPhotos(result.photos);
        setNotice(null);
        setActivePersonId(allPeopleId);
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        setNotice(error instanceof Error ? error.message : "Library load failed.");
      });

    return () => {
      isCancelled = true;
    };
  }, [activeEventId, authSession]);

  const selectedPerson = people.find((person) => person.id === activePersonId);

  const visiblePhotos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return photos.filter((photo) => {
      const matchesPerson =
        activePersonId === allPeopleId ||
        (activePersonId === reviewId &&
          photo.matches.some((match) => isPendingReviewStatus(match.status))) ||
        photo.matches.some(
          (match) =>
            match.personId === activePersonId && match.status !== "rejected",
        );

      if (!matchesPerson) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        photo.name.toLowerCase().includes(normalizedQuery) ||
        photo.matches.some((match) =>
          match.personName.toLowerCase().includes(normalizedQuery),
        )
      );
    });
  }, [activePersonId, photos, query]);

  async function handleFiles(mode: UploadMode, files: File[]) {
    const acceptedFiles = files.filter((file) => file.type.startsWith("image/"));

    if (acceptedFiles.length === 0) {
      setNotice("No supported image files selected.");
      return;
    }
    if (hasConfiguredApi && hasConfiguredAuth && !authSession) {
      setNotice("Sign in before uploading photos.");
      return;
    }
    if (!activeEvent) {
      setNotice("Create an event before uploading photos.");
      return;
    }
    if (mode === "references" && !consentConfirmed) {
      setNotice("Confirm guest consent before adding reference photos.");
      return;
    }

    setIsUploading(true);
    setNotice(null);

    try {
      const result = await submitUpload({
        consentConfirmed,
        eventId: activeEvent.id,
        mode,
        files: acceptedFiles,
        people,
        session: authSession,
      });

      if (result.people.length > 0) {
        setPeople((current) => mergePeople(current, result.people));
        setActivePersonId(result.people[0].id);
      }

      if (result.photos.length > 0) {
        setPhotos((current) => [...result.photos, ...current]);
        adjustPhotoCounts(result.photos, 1, setPeople);
        setActivePersonId(allPeopleId);
      }

      setNotice(
        mode === "references"
          ? `${result.people.length} guest profile${result.people.length === 1 ? "" : "s"} ready for matching.`
          : `${result.photos.length} event photo${result.photos.length === 1 ? "" : "s"} matched into galleries.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeletePhoto(photo: PhotoAsset) {
    if (!window.confirm(`Remove ${photo.name} from this library?`)) {
      return;
    }
    if (hasConfiguredApi && hasConfiguredAuth && !authSession) {
      setNotice("Sign in before deleting photos.");
      return;
    }

    setDeletingPhotoIds((current) => new Set(current).add(photo.id));
    setNotice(null);

    try {
      await deletePhoto(photo.id, authSession);
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      adjustPhotoCounts([photo], -1, setPeople);
      setNotice(`${photo.name} removed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Photo delete failed.");
    } finally {
      setDeletingPhotoIds((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
    }
  }

  async function handleDeletePerson(person: Person) {
    if (
      !window.confirm(
        `Remove ${person.name}, their reference images, and their photo matches?`,
      )
    ) {
      return;
    }
    if (hasConfiguredApi && hasConfiguredAuth && !authSession) {
      setNotice("Sign in before deleting people.");
      return;
    }

    setDeletingPersonIds((current) => new Set(current).add(person.id));
    setNotice(null);

    try {
      await deletePerson(person.id, authSession);
      setPeople((current) => current.filter((item) => item.id !== person.id));
      setPhotos((current) =>
        current.map((photo) => ({
          ...photo,
          matches: photo.matches.filter((match) => match.personId !== person.id),
        })),
      );
      if (activePersonId === person.id) {
        setActivePersonId(allPeopleId);
      }
      setNotice(`${person.name} removed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Person delete failed.");
    } finally {
      setDeletingPersonIds((current) => {
        const next = new Set(current);
        next.delete(person.id);
        return next;
      });
    }
  }

  async function handleCreateEvent() {
    const name = newEventName.trim();
    if (name.length < 2) {
      setNotice("Add an event name first.");
      return;
    }
    if (hasConfiguredApi && hasConfiguredAuth && !authSession) {
      setNotice("Sign in before creating an event.");
      return;
    }

    setNotice(null);

    try {
      const event = await createEvent(name, authSession);
      setEvents((current) => [event, ...current]);
      setActiveEventId(event.id);
      setPeople([]);
      setPhotos([]);
      setNewEventName("");
      setConsentConfirmed(false);
      setActivePersonId(allPeopleId);
      setNotice(`${event.name} workspace created.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Event create failed.");
    }
  }

  async function handleReviewMatch(
    photo: PhotoAsset,
    personId: string,
    status: Extract<MatchStatus, "approved" | "rejected">,
  ) {
    if (hasConfiguredApi && hasConfiguredAuth && !authSession) {
      setNotice("Sign in before reviewing matches.");
      return;
    }

    const matchId = `${photo.id}:${personId}`;
    setReviewingMatchIds((current) => new Set(current).add(matchId));
    setNotice(null);

    try {
      const updated =
        (await updateMatchStatus({
          photoId: photo.id,
          personId,
          session: authSession,
          status,
        })) ?? {
          ...photo.matches.find((match) => match.personId === personId)!,
          status,
          reviewedAt: new Date().toISOString(),
        };

      setPhotos((current) =>
        current.map((item) =>
          item.id === photo.id
            ? {
                ...item,
                matches: item.matches.map((match) =>
                  match.personId === personId ? { ...match, ...updated } : match,
                ),
              }
            : item,
        ),
      );

      if (status === "rejected") {
        setPeople((current) =>
          current.map((person) =>
            person.id === personId
              ? { ...person, photoCount: Math.max(0, person.photoCount - 1) }
              : person,
          ),
        );
      }

      setNotice(status === "approved" ? "Match approved." : "Match rejected.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Review update failed.");
    } finally {
      setReviewingMatchIds((current) => {
        const next = new Set(current);
        next.delete(matchId);
        return next;
      });
    }
  }

  function handleSignIn() {
    void startSignIn().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Sign-in failed.");
    });
  }

  function handleSignUp() {
    void startSignUp().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Sign-up failed.");
    });
  }

  if (hasConfiguredApi && hasConfiguredAuth && (isAuthLoading || !authSession)) {
    return (
      <main className="auth-shell">
        <section className="auth-layout" aria-label="Sign in or create account">
          <div className="auth-panel">
            <div className="auth-brand-row">
              <div className="brand-mark">
                <UsersRound size={22} aria-hidden="true" />
              </div>
              <span>FaceID Events</span>
            </div>
            <p className="eyebrow">Private event galleries</p>
            <h1>Deliver face-sorted galleries after every event.</h1>
            <p className="auth-copy">
              Give photographers and event teams private event workspaces, consented
              guest references, review decisions, and owner-controlled deletes.
            </p>
            <div className="auth-actions">
              <button
                className="primary-action"
                disabled={isAuthLoading}
                onClick={handleSignIn}
                type="button"
              >
                {isAuthLoading ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <LogIn size={18} aria-hidden="true" />
                )}
                <span>{isAuthLoading ? "Checking sign-in" : "Sign in"}</span>
              </button>
              <button
                className="secondary-action"
                disabled={isAuthLoading}
                onClick={handleSignUp}
                type="button"
              >
                <UserRoundPlus size={18} aria-hidden="true" />
                <span>Create account</span>
              </button>
            </div>
            <div className="auth-trust-row" aria-label="Security and storage">
              <span>
                <ShieldCheck size={15} aria-hidden="true" />
                Review gates
              </span>
              <span>
                <ClipboardCheck size={15} aria-hidden="true" />
                Consent intake
              </span>
              <span>
                <Trash2 size={15} aria-hidden="true" />
                Delete ready
              </span>
            </div>
            {notice && (
              <div className="notice auth-notice" role="status">
                {isAuthLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <ShieldCheck size={18} />
                )}
                <span>{notice}</span>
              </div>
            )}
          </div>
          <div className="auth-preview" aria-hidden="true">
            <div className="preview-toolbar">
              <span>Spring Gala</span>
              <strong>Private</strong>
            </div>
            <div className="preview-upload-row">
              <div>
                <UserRoundPlus size={18} />
                <span>Guest references</span>
              </div>
              <div>
                <ImagePlus size={18} />
                <span>Event photos</span>
              </div>
            </div>
            <div className="preview-photo-grid">
              {initialPhotos.slice(0, 2).map((photo) => (
                <div className="preview-photo" key={photo.id}>
                  <img src={photo.previewUrl} alt="" />
                  <span>{photo.matches[0]?.personName}</span>
                </div>
              ))}
            </div>
            <div className="preview-people-row">
              {initialPeople.map((person) => (
                <span key={person.id}>{person.initials}</span>
              ))}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="People and filters">
        <div className="brand-row">
          <div className="brand-mark">
            <UsersRound size={22} aria-hidden="true" />
          </div>
          <div>
            <h1>FaceID Events</h1>
            <span>
              {authSession?.email ??
                (hasConfiguredApi ? "Private workspace" : "Local event preview")}
            </span>
          </div>
        </div>

        <section className="event-card" aria-label="Event workspace">
          <p className="eyebrow">Event workspace</p>
          <select
            aria-label="Select event workspace"
            onChange={(event) => setActiveEventId(event.target.value)}
            value={activeEvent?.id ?? ""}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
          <div className="new-event-row">
            <input
              aria-label="New event name"
              onChange={(event) => setNewEventName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCreateEvent();
                }
              }}
              placeholder="New event"
              value={newEventName}
            />
            <button
              aria-label="Create event"
              onClick={() => void handleCreateEvent()}
              title="Create event"
              type="button"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="event-meta">
            <span>Private gallery</span>
            <span>{people.length} guests</span>
          </div>
        </section>

        <nav className="person-nav" aria-label="Photo filters">
          <button
            className={activePersonId === allPeopleId ? "active" : ""}
            type="button"
            onClick={() => setActivePersonId(allPeopleId)}
          >
            <Images size={18} aria-hidden="true" />
            <span>Event Photos</span>
            <strong>{photos.length}</strong>
          </button>
          <button
            className={activePersonId === reviewId ? "active" : ""}
            type="button"
            onClick={() => setActivePersonId(reviewId)}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <span>Review Queue</span>
            <strong>{reviewCount}</strong>
          </button>
        </nav>

        <div className="side-section">
          <div className="section-title">
            <span>Guest Galleries</span>
            <strong>{people.length}</strong>
          </div>
          <div className="people-list">
            {people.map((person) => (
              <div
                className={activePersonId === person.id ? "person active" : "person"}
                key={person.id}
              >
                <button
                  className="person-main"
                  type="button"
                  onClick={() => setActivePersonId(person.id)}
                >
                  <span className="avatar">{person.initials}</span>
                  <span className="person-copy">
                    <span>{person.name}</span>
                    <small>{person.photoCount} matched photos</small>
                  </span>
                </button>
                <button
                  aria-label={`Remove ${person.name}`}
                  className="icon-button"
                  disabled={deletingPersonIds.has(person.id)}
                  onClick={() => void handleDeletePerson(person)}
                  title={`Remove ${person.name}`}
                  type="button"
                >
                  {deletingPersonIds.has(person.id) ? (
                    <Loader2 className="spin" size={15} aria-hidden="true" />
                  ) : (
                    <Trash2 size={15} aria-hidden="true" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private event gallery</p>
            <h2>
              {selectedPerson
                ? `${selectedPerson.name}'s Gallery`
                : activePersonId === reviewId
                  ? "Review Queue"
                  : eventWorkspaceName}
            </h2>
            <p className="topbar-subtitle">
              {selectedPerson
                ? "Photos matched to this guest stay private in the owner's workspace."
                : activePersonId === reviewId
                  ? "Candidate matches stay here until approved or rejected."
                  : "Upload guest references and event photos into one owner-managed gallery."}
            </p>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                aria-label="Search photos and people"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                value={query}
              />
            </label>
            {hasConfiguredAuth && authSession && (
              <button className="account-button" onClick={signOut} type="button">
                <LogOut size={17} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </header>

        <section className="upload-strip" aria-label="Upload files">
          <UploadZone
            disabled={isUploading}
            icon={<UserRoundPlus size={22} aria-hidden="true" />}
            helper="named files"
            label="Guest References"
            mode="references"
            onFiles={handleFiles}
          />
          <UploadZone
            disabled={isUploading}
            icon={<ImagePlus size={22} aria-hidden="true" />}
            helper="match into galleries"
            label="Event Photos"
            mode="photos"
            onFiles={handleFiles}
          />
          <label className="consent-card">
            <input
              checked={consentConfirmed}
              onChange={(event) => setConsentConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span className="consent-icon">
              <ClipboardCheck size={20} aria-hidden="true" />
            </span>
            <span>
              <strong>Consent captured</strong>
              <small>reference intake</small>
            </span>
          </label>
          <div className="pipeline">
            <PipelineStep icon={<Cloud size={17} />} label="Private S3" />
            <PipelineStep icon={<Search size={17} />} label="Face Match" />
            <PipelineStep icon={<Database size={17} />} label="Metadata" />
            <PipelineStep icon={<ShieldCheck size={17} />} label="Review Gate" />
          </div>
        </section>

        {notice && (
          <div className="notice" role="status">
            {isUploading ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
            <span>{notice}</span>
          </div>
        )}

        <section className="stats-grid" aria-label="Library metrics">
          <Metric label="Guests" value={people.length.toString()} />
          <Metric label="Event Photos" value={photos.length.toString()} />
          <Metric label="Approved" value={approvedCount.toString()} />
          <Metric
            label="Pending Review"
            value={pendingDecisionCount.toString()}
            tone="warning"
          />
        </section>

        <section className="delivery-strip" aria-label="Event delivery status">
          <DeliveryStatus
            icon={<UserRoundPlus size={17} />}
            label="Guest intake"
            value={`${people.length} profiles`}
          />
          <DeliveryStatus
            icon={<ShieldCheck size={17} />}
            label="Review queue"
            value={`${reviewCount} photos`}
          />
          <DeliveryStatus
            icon={<Trash2 size={17} />}
            label="Data control"
            value="Delete enabled"
          />
        </section>

        <PhotoGrid
          deletingPhotoIds={deletingPhotoIds}
          onDeletePhoto={handleDeletePhoto}
          onReviewMatch={handleReviewMatch}
          photos={visiblePhotos}
          reviewingMatchIds={reviewingMatchIds}
        />
      </section>
    </main>
  );
}

type UploadZoneProps = {
  disabled: boolean;
  helper: string;
  icon: ReactNode;
  label: string;
  mode: UploadMode;
  onFiles: (mode: UploadMode, files: File[]) => void;
};

function UploadZone({
  disabled,
  helper,
  icon,
  label,
  mode,
  onFiles,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  function submitFiles(fileList: FileList | null) {
    if (!fileList || disabled) {
      return;
    }
    onFiles(mode, Array.from(fileList));
  }

  return (
    <label
      className={`upload-zone ${isDragging ? "dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        submitFiles(event.dataTransfer.files);
      }}
    >
      <input
        accept="image/*"
        disabled={disabled}
        multiple
        onChange={(event) => submitFiles(event.currentTarget.files)}
        type="file"
      />
      <span className="upload-icon">{icon}</span>
      <span>{label}</span>
      <small>{helper}</small>
      {disabled && <Loader2 className="spin" size={18} aria-hidden="true" />}
    </label>
  );
}

function PipelineStep({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="pipeline-step">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DeliveryStatus({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="delivery-status">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PhotoGrid({
  deletingPhotoIds,
  onDeletePhoto,
  onReviewMatch,
  photos,
  reviewingMatchIds,
}: {
  deletingPhotoIds: Set<string>;
  onDeletePhoto: (photo: PhotoAsset) => void;
  onReviewMatch: (
    photo: PhotoAsset,
    personId: string,
    status: Extract<MatchStatus, "approved" | "rejected">,
  ) => void;
  photos: PhotoAsset[];
  reviewingMatchIds: Set<string>;
}) {
  if (photos.length === 0) {
    return (
      <div className="empty-state">
        <UploadCloud size={30} aria-hidden="true" />
        <span>No event photos in this view.</span>
      </div>
    );
  }

  return (
    <section className="photo-grid" aria-label="Event gallery photos">
      {photos.map((photo) => (
        <article className="photo-card" key={photo.id}>
          <div className="photo-media">
            <img src={photo.previewUrl} alt="" />
            <button
              aria-label={`Remove ${photo.name}`}
              className="photo-delete-button"
              disabled={deletingPhotoIds.has(photo.id)}
              onClick={() => onDeletePhoto(photo)}
              title={`Remove ${photo.name}`}
              type="button"
            >
              {deletingPhotoIds.has(photo.id) ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="photo-card-body">
            <div className="photo-title-row">
              <strong title={photo.name}>{photo.name}</strong>
              <span>{formatSize(photo.size)}</span>
            </div>
            <div className="match-list">
              {photo.matches.map((match) => (
                <div className={`match-pill ${match.status}`} key={match.personId}>
                  <span>{match.personName}</span>
                  <strong>{match.confidence.toFixed(1)}%</strong>
                  {isPendingReviewStatus(match.status) && (
                    <span className="review-actions">
                      <button
                        aria-label={`Approve ${match.personName} in ${photo.name}`}
                        disabled={reviewingMatchIds.has(
                          `${photo.id}:${match.personId}`,
                        )}
                        onClick={() =>
                          onReviewMatch(photo, match.personId, "approved")
                        }
                        title="Approve match"
                        type="button"
                      >
                        <Check size={13} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`Reject ${match.personName} in ${photo.name}`}
                        disabled={reviewingMatchIds.has(
                          `${photo.id}:${match.personId}`,
                        )}
                        onClick={() =>
                          onReviewMatch(photo, match.personId, "rejected")
                        }
                        title="Reject match"
                        type="button"
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function mergePeople(currentPeople: Person[], incomingPeople: Person[]) {
  const byName = new Map(
    currentPeople.map((person) => [person.name.toLowerCase(), { ...person }]),
  );

  for (const incoming of incomingPeople) {
    const existing = byName.get(incoming.name.toLowerCase());
    if (existing) {
      existing.referenceCount += incoming.referenceCount;
      continue;
    }
    byName.set(incoming.name.toLowerCase(), incoming);
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function adjustPhotoCounts(
  photos: PhotoAsset[],
  direction: 1 | -1,
  setPeople: Dispatch<SetStateAction<Person[]>>,
) {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    for (const match of photo.matches) {
      if (match.status === "rejected") {
        continue;
      }
      counts.set(match.personId, (counts.get(match.personId) ?? 0) + 1);
    }
  }

  setPeople((current) =>
    current.map((person) => ({
      ...person,
      photoCount: Math.max(
        0,
        person.photoCount + direction * (counts.get(person.id) ?? 0),
      ),
    })),
  );
}

function isPendingReviewStatus(status: MatchStatus) {
  return status === "matched" || status === "needs_review";
}

function formatSize(size: number) {
  if (size < 1_000_000) {
    return `${Math.max(1, Math.round(size / 1000))} KB`;
  }
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

export default App;
