import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Info,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createLiveClient, type WorkspaceClient } from "./client";
import { createDemoClient } from "./demoClient";
import { DeliverView } from "./DeliverView";
import { pluralize } from "./format";
import { GuestsView } from "./GuestsView";
import { Link } from "./Link";
import { buildReviewEntries, countPendingDecisions, deriveGuestStats } from "./library";
import { PhotosView } from "./PhotosView";
import { ReviewView } from "./ReviewView";
import type { AuthSession } from "./auth";
import { Dialog, EmptyState, Spinner } from "./ui";
import { useWorkspace, type Notice } from "./useWorkspace";

type Tab = "guests" | "photos" | "review" | "deliver";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "guests", label: "Guests" },
  { id: "photos", label: "Photos" },
  { id: "review", label: "Review" },
  { id: "deliver", label: "Deliver" },
];

type WorkspaceProps =
  | { mode: "demo" }
  | {
      accountEmail?: string;
      mode: "live";
      onSessionExpired: () => void;
      onSignOut: () => void;
      session: AuthSession;
    };

const noop = () => undefined;

export function Workspace(props: WorkspaceProps) {
  // The client is fixed for the life of this component (App re-mounts it per
  // session), so the sample client keeps its in-memory data across renders.
  const [client] = useState<WorkspaceClient>(() =>
    props.mode === "demo" ? createDemoClient() : createLiveClient(props.session),
  );
  const isDemo = props.mode === "demo";
  const getIntakeLink = client.getIntakeLink;
  const onSessionExpired = props.mode === "live" ? props.onSessionExpired : noop;

  const ws = useWorkspace({ client, onSessionExpired });
  const [tab, setTab] = useState<Tab>("guests");
  const [isCreating, setIsCreating] = useState(false);
  const [newEventName, setNewEventName] = useState("");

  const { library } = ws;
  const activeEvent = ws.events.find((event) => event.id === ws.activeEventId);
  const isShowingActiveEvent = library.eventId === ws.activeEventId && ws.activeEventId !== "";
  const hasData = library.people.length > 0 || library.photos.length > 0;
  const showViews =
    isShowingActiveEvent &&
    (library.status === "ready" || (library.status === "loading" && hasData));

  const stats = useMemo(() => deriveGuestStats(library.photos), [library.photos]);
  const entries = useMemo(
    () => buildReviewEntries(library.photos, library.people),
    [library.photos, library.people],
  );
  const pending = useMemo(() => countPendingDecisions(library.photos), [library.photos]);
  const approvedPairs = entries.filter((entry) => entry.match.status === "approved").length;
  const noMatchPhotoCount = library.photos.filter((photo) => photo.matches.length === 0).length;

  useEffect(() => {
    document.title = isDemo ? "Sample workspace · FaceID Events" : "Workspace · FaceID Events";
  }, [isDemo]);

  async function submitNewEvent(event: FormEvent) {
    event.preventDefault();
    const created = await ws.createEvent(newEventName);
    if (created) {
      setNewEventName("");
      setIsCreating(false);
      setTab("guests");
    }
  }

  function openNewEvent() {
    ws.dismissNotice();
    setNewEventName("");
    setIsCreating(true);
  }

  const nextStep = (() => {
    if (!showViews) {
      return null;
    }
    if (library.people.length === 0 && tab !== "guests") {
      return {
        label: "Add a guest",
        target: "guests" as Tab,
        text: "Start by adding a guest with reference photos.",
      };
    }
    if (library.people.length > 0 && library.photos.length === 0 && tab !== "photos") {
      return {
        label: "Upload photos",
        target: "photos" as Tab,
        text: "Next, upload event photos to match against your guests.",
      };
    }
    if (pending > 0 && tab !== "review") {
      return {
        label: "Review matches",
        target: "review" as Tab,
        text: `${pluralize(pending, "suggested match", "suggested matches")} ${pending === 1 ? "is" : "are"} waiting for your decision.`,
      };
    }
    if (pending === 0 && approvedPairs > 0 && tab !== "deliver") {
      return {
        label: "Open Deliver",
        target: "deliver" as Tab,
        text: "Approved matches are ready to export as a photo list.",
      };
    }
    return null;
  })();

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>

      <header className="app-header">
        <div className="app-header-row">
          <Link className="wordmark" href="/">
            FaceID Events
          </Link>
          <div className="event-bar">
            <label className="visually-hidden" htmlFor="event-select">
              Event
            </label>
            <select
              className="event-select"
              disabled={ws.isBusy || ws.events.length === 0}
              id="event-select"
              onChange={(event) => ws.selectEvent(event.target.value)}
              value={ws.activeEventId}
            >
              {ws.events.length === 0 && <option value="">Your events</option>}
              {ws.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
            <button
              aria-label="Create a new event"
              className="button button-icon button-ghost"
              disabled={ws.isBusy}
              onClick={openNewEvent}
              title="New event"
              type="button"
            >
              <Plus aria-hidden="true" size={19} />
            </button>
            {showViews && (
              <button
                aria-label="Refresh event"
                className="button button-icon button-ghost"
                disabled={ws.isBusy}
                onClick={ws.refresh}
                title="Refresh event"
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={library.status === "loading" ? "spin" : undefined}
                  size={17}
                />
              </button>
            )}
          </div>
          <div className="account">
            {props.mode === "live" ? (
              <>
                {props.accountEmail && (
                  <span className="account-email truncate">{props.accountEmail}</span>
                )}
                <button className="button button-compact" onClick={props.onSignOut} type="button">
                  <LogOut aria-hidden="true" size={16} />
                  Sign out
                </button>
              </>
            ) : (
              <>
                <span className="tag">Sample</span>
                <Link className="text-link" href="/">
                  Leave sample
                </Link>
              </>
            )}
          </div>
        </div>

        {isCreating && (
          <Dialog busy={ws.isBusy} onClose={() => setIsCreating(false)} title="Create an event">
            <form className="new-event" onSubmit={(event) => void submitNewEvent(event)}>
              <label className="label" htmlFor="new-event-name">
                Event name
              </label>
              <input
                autoComplete="off"
                data-initial-focus
                id="new-event-name"
                maxLength={80}
                disabled={ws.isBusy}
                onChange={(event) => setNewEventName(event.target.value)}
                placeholder="e.g. Harper wedding"
                required
                value={newEventName}
              />
              {ws.notice?.tone === "error" && (
                <p className="field-error" role="alert">
                  {ws.notice.text}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={ws.isBusy}
                  onClick={() => {
                    setIsCreating(false);
                    setNewEventName("");
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={ws.isBusy} type="submit">
                  <Plus aria-hidden="true" size={17} /> {ws.isBusy ? "Creating..." : "Create event"}
                </button>
              </div>
            </form>
          </Dialog>
        )}
      </header>

      {isDemo && (
        <div className="demo-banner">
          <details className="demo-details">
            <summary>
              Sample workspace <span>Simulated matches, saved only in this tab</span>
              <ChevronDown aria-hidden="true" size={15} />
            </summary>
            <p>
              Names, photos and scores are examples; no face analysis runs. Your uploads stay in
              this browser. Changes disappear when you leave or reload. Guest invitation links are
              available in live events.
            </p>
          </details>
          <div className="demo-banner-actions">
            <button
              aria-label="Reset sample workspace"
              className="button button-icon button-ghost"
              disabled={ws.isBusy}
              onClick={ws.resetSample}
              title="Reset sample"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={16} />
            </button>
            <Link className="text-link" href="/app">
              Start a real event
            </Link>
          </div>
        </div>
      )}

      <nav aria-label="Workspace sections" className="tabs">
        {tabs.map(({ id, label }) => (
          <button
            aria-current={tab === id ? "page" : undefined}
            className="tab"
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
            {id === "review" && pending > 0 && (
              <>
                <span aria-hidden="true" className="count">
                  {pending}
                </span>
                <span className="visually-hidden">
                  {" "}
                  ({pending} pending {pending === 1 ? "decision" : "decisions"})
                </span>
              </>
            )}
          </button>
        ))}
      </nav>

      <div className="notices">
        <div aria-live="polite" role="status">
          {ws.notice && ws.notice.tone !== "error" && (
            <NoticeBox notice={ws.notice} onDismiss={ws.dismissNotice} />
          )}
        </div>
        <div role="alert">
          {ws.notice && ws.notice.tone === "error" && (
            <NoticeBox notice={ws.notice} onDismiss={ws.dismissNotice} />
          )}
        </div>
      </div>

      <main className="main" id="main" tabIndex={-1}>
        {ws.eventsState.status === "loading" && (
          <div className="state-block">
            <Spinner label="Loading your events…" />
          </div>
        )}

        {ws.eventsState.status === "error" && (
          <div className="state-block">
            <EmptyState
              action={
                <button className="button button-primary" onClick={ws.retryEvents} type="button">
                  <RefreshCw aria-hidden="true" size={17} />
                  Try again
                </button>
              }
              title="Your events couldn't be loaded"
            >
              {ws.eventsState.error}
            </EmptyState>
          </div>
        )}

        {ws.eventsState.status === "ready" && ws.events.length === 0 && (
          <div className="state-block">
            <EmptyState
              action={
                <button className="button button-primary" onClick={openNewEvent} type="button">
                  Create an event
                </button>
              }
              title="Create your first event"
            >
              Each event keeps its own guests, photos and decisions.
            </EmptyState>
          </div>
        )}

        {ws.eventsState.status === "ready" && ws.events.length > 0 && (
          <>
            {isShowingActiveEvent && library.status === "loading" && !showViews && (
              <div className="state-block">
                <Spinner label="Loading this event…" />
              </div>
            )}

            {isShowingActiveEvent && library.status === "error" && (
              <div className="state-block">
                <EmptyState
                  action={
                    <button className="button button-primary" onClick={ws.refresh} type="button">
                      <RefreshCw aria-hidden="true" size={17} />
                      Try again
                    </button>
                  }
                  title="This event couldn't be loaded"
                >
                  {library.error}
                </EmptyState>
              </div>
            )}

            {showViews && tab === "guests" && (
              <GuestsView
                isBusy={ws.isBusy}
                key={ws.activeEventId}
                onAddGuest={ws.addGuest}
                onDeleteGuest={(person) => void ws.deleteGuest(person)}
                onGetIntakeLink={getIntakeLink ? () => getIntakeLink(ws.activeEventId) : undefined}
                onRefresh={ws.refresh}
                people={library.people}
                stats={stats}
                submissionError={ws.notice?.tone === "error" ? ws.notice.text : undefined}
              />
            )}

            {showViews && tab === "photos" && (
              <PhotosView
                isBusy={ws.isBusy}
                isDemo={isDemo}
                key={ws.activeEventId}
                onDeletePhoto={(photo) => void ws.deletePhoto(photo)}
                onDismissQueue={ws.dismissQueue}
                onDismissRejected={() => ws.setRejectedFiles([])}
                onGoToGuests={() => setTab("guests")}
                onRefresh={ws.refresh}
                onRetry={ws.retryFailedUploads}
                onReview={(entry, status) => void ws.reviewMatch(entry, status)}
                onUpload={ws.uploadPhotos}
                people={library.people}
                photos={library.photos}
                queue={ws.queue}
                rejected={ws.rejectedFiles}
                reviewingKeys={ws.reviewingKeys}
              />
            )}

            {showViews && tab === "review" && (
              <ReviewView
                entries={entries}
                hasPhotos={library.photos.length > 0}
                isDemo={isDemo}
                key={ws.activeEventId}
                noMatchPhotoCount={noMatchPhotoCount}
                onGoToDeliver={() => setTab("deliver")}
                onGoToPhotos={() => setTab("photos")}
                onRefresh={ws.refresh}
                onReview={ws.reviewMatch}
                reviewingKeys={ws.reviewingKeys}
              />
            )}

            {showViews && tab === "deliver" && (
              <DeliverView
                eventId={ws.activeEventId}
                eventName={activeEvent?.name ?? "event"}
                key={ws.activeEventId}
                onGoToReview={() => setTab("review")}
                people={library.people}
                photos={library.photos}
              />
            )}
            {showViews && nextStep && (
              <div className="next-step">
                <p>{nextStep.text}</p>
                <button
                  className="text-button"
                  onClick={() => setTab(nextStep.target)}
                  type="button"
                >
                  {nextStep.label}
                  <ArrowRight aria-hidden="true" size={17} />
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function NoticeBox({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const Icon =
    notice.tone === "error" ? AlertTriangle : notice.tone === "success" ? CheckCircle2 : Info;

  return (
    <div className={`notice notice-${notice.tone}`} key={notice.id}>
      <Icon aria-hidden="true" size={18} />
      <p>{notice.text}</p>
      {notice.action && (
        <button className="text-button" onClick={notice.action.run} type="button">
          {notice.action.label}
        </button>
      )}
      <button
        aria-label="Dismiss message"
        className="button button-icon"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
