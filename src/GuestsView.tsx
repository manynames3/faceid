import {
  Check,
  ClipboardCopy,
  ImagePlus,
  Link2,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatDate, pluralize } from "./format";
import { errorMessage } from "./errors";
import { Link } from "./Link";
import { ReferenceSelection } from "./ReferencePhotos";
import type { IntakeLink } from "./api";
import type { GuestStats } from "./library";
import type { AddGuestInput } from "./useWorkspace";
import type { EventWorkspace, Person } from "./types";
import { ACCEPT_ATTRIBUTE, MAX_REFERENCE_FILES, validateImageFiles } from "./uploads";
import type { RejectedFile } from "./uploads";
import { ConfirmDialog, Dialog, EmptyState, PhotoImage, Spinner } from "./ui";

const noStats: GuestStats = { approved: 0, awaiting: 0, rejected: 0 };

function consentText(person: Person) {
  if (person.consentStatus !== "captured") return "Permission has not been recorded.";
  const who =
    person.consentSource === "guest_submitted" ? "Submitted by the guest" : "Confirmed by you";
  const when = formatDate(person.consentCapturedAt);
  return who + (when ? " on " + when : "") + ".";
}

export function GuestsView({
  event,
  isDemo,
  onEditEvent,
  onFindGuest,
  hasPhotos,
  isBusy,
  onAddGuest,
  onDeleteGuest,
  onGetIntakeLink,
  onRefresh,
  people,
  stats,
  submissionError,
}: {
  event?: EventWorkspace;
  isDemo: boolean;
  onEditEvent: () => void;
  onFindGuest: (personId: string) => void;
  hasPhotos: boolean;
  isBusy: boolean;
  onAddGuest: (input: AddGuestInput) => Promise<boolean>;
  onDeleteGuest: (person: Person) => void;
  onGetIntakeLink?: () => Promise<IntakeLink>;
  onRefresh: () => void;
  people: Person[];
  stats: Map<string, GuestStats>;
  submissionError?: string;
}) {
  const [formTarget, setFormTarget] = useState<Person | "new" | null>(null);
  const [viewing, setViewing] = useState<Person | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Person | null>(null);
  const [inviting, setInviting] = useState(false);
  const deleteStats = pendingDelete ? (stats.get(pendingDelete.id) ?? noStats) : noStats;
  const viewedPerson = people.find((person) => person.id === viewing?.id);
  const readyToInvite = event?.signupOpen !== false && Boolean(event?.hostName && event?.contactEmail);

  return (
    <div className="view guests-view">
      <div className="view-heading">
        <div>
          <h1>Guests</h1>
          <p className="view-subtitle">
            {people.length
              ? pluralize(people.length, "guest") + " in this event"
              : "Every photo collection starts with your people."}
          </p>
        </div>
        <div className="actions">
          <button
            className={"button" + (!onGetIntakeLink ? " button-primary" : "")}
            disabled={isBusy}
            onClick={() => setFormTarget("new")}
            type="button"
          >
            <Plus aria-hidden="true" size={18} /> {onGetIntakeLink ? "Add manually" : "Add guest"}
          </button>
          {onGetIntakeLink && (
            <button
              className="button button-primary"
              disabled={isBusy}
              onClick={() => readyToInvite ? setInviting(true) : onEditEvent()}
              type="button"
            >
              <Link2 aria-hidden="true" size={18} /> {event?.signupOpen === false ? "Reopen signup" : "Invite guests"}
            </button>
          )}
        </div>
      </div>

      {isDemo && <div className="guest-preview-link"><span>See the other side of the invitation.</span><Link href="/demo/guest">Preview guest signup <Link2 aria-hidden="true" size={15} /></Link></div>}
      {!isDemo && !readyToInvite && <div className="setup-note"><p>{event?.signupOpen === false ? "Guest signup is closed. Your existing guest list is unchanged." : "Add your host name and contact email before inviting guests."}</p><button className="text-button" disabled={isBusy} onClick={onEditEvent} type="button">Event details</button></div>}

      {people.length === 0 ? (
        <div className="guest-empty">
          <UsersRound aria-hidden="true" size={32} />
          <EmptyState title="Let's bring your guests in.">Invite guests to send a reference photo and permission, or add them yourself.</EmptyState>
          <ol className="event-start-steps"><li><span>1</span> Invite your guests</li><li><span>2</span> Wait for their references</li><li><span>3</span> Upload your event photos</li></ol>
        </div>
      ) : (
        <ul aria-label="Event guests" className="guest-grid">
          {people.map((person) => {
            const counts = stats.get(person.id) ?? noStats;
            return (
              <li className="guest-card" key={person.id}>
                <button
                  aria-label={"View reference for " + person.name}
                  className="guest-portrait"
                  onClick={() => setViewing(person)}
                  type="button"
                >
                  {person.referencePreviewUrl ? (
                    <PhotoImage
                      alt={"Reference portrait of " + person.name}
                      src={person.referencePreviewUrl}
                    />
                  ) : (
                    <span className="portrait-initials">{person.initials}</span>
                  )}
                </button>
                <div className="guest-card-body">
                  <div className="guest-card-heading">
                    <h2>{person.name}</h2>
                    <GuestMenu
                      isBusy={isBusy}
                      onDelete={() => setPendingDelete(person)}
                      onDetails={() => setViewing(person)}
                      person={person}
                    />
                  </div>
                  <p
                    className={
                      person.consentStatus === "captured" && !person.deletionPending
                        ? "permission permission-recorded"
                        : "permission permission-missing"
                    }
                  >
                    {person.consentStatus === "captured" ? (
                      <Check aria-hidden="true" size={15} />
                    ) : (
                      <ShieldCheck aria-hidden="true" size={15} />
                    )}
                    {person.deletionPending ? "Removal incomplete. Retry from the menu." : person.consentStatus === "captured"
                      ? "Permission recorded"
                      : "Permission missing"}
                  </p>
                  <dl className="guest-counts">
                    <div>
                      <dt>{person.referenceCount === 1 ? "reference" : "references"}</dt>
                      <dd>{person.referenceCount}</dd>
                    </div>
                    <div className={counts.awaiting ? "has-pending" : ""}>
                      <dt>to review</dt>
                      <dd>{counts.awaiting}</dd>
                    </div>
                    <div>
                      <dt>approved</dt>
                      <dd>{counts.approved}</dd>
                    </div>
                  </dl>
                  <div className="guest-card-footer">
                    <button className="text-button" disabled={isBusy || !hasPhotos || person.deletionPending || person.consentStatus !== "captured"} onClick={() => onFindGuest(person.id)} type="button">Find in photos</button>
                    {person.referenceCount < MAX_REFERENCE_FILES ? (
                      <button
                        className="text-button"
                        disabled={isBusy || person.deletionPending}
                        onClick={() => setFormTarget(person)}
                        type="button"
                      >
                        <ImagePlus aria-hidden="true" size={17} /> Add reference
                      </button>
                    ) : (
                      <span className="reference-complete">
                        <Check aria-hidden="true" size={15} /> References complete
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {formTarget && (
        <GuestForm
          isBusy={isBusy}
          onAddGuest={onAddGuest}
          onClose={() => setFormTarget(null)}
          submissionError={submissionError}
          target={formTarget === "new" ? undefined : formTarget}
        />
      )}
      {inviting && onGetIntakeLink && (
        <InviteDialog onClose={() => setInviting(false)} onGetLink={onGetIntakeLink} />
      )}
      {viewedPerson && (
        <Dialog onClose={() => setViewing(null)} title={viewedPerson.name}>
          <div className="guest-profile">
            {viewedPerson.referencePreviewUrl && (
              <PhotoImage
                alt={"Reference photo of " + viewedPerson.name}
                className="guest-profile-image"
                eager
                onReload={onRefresh}
                src={viewedPerson.referencePreviewUrl}
              />
            )}
            <div className="profile-details">
              <h3>Photo permission</h3>
              <p>{consentText(viewedPerson)}</p>
              <p className="hint">
                {pluralize(viewedPerson.referenceCount, "reference photo")} saved. Up to two are
                used for matching.
              </p>
            </div>
          </div>
        </Dialog>
      )}
      {pendingDelete && (
        <ConfirmDialog
          confirmLabel="Delete guest"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const person = pendingDelete;
            setPendingDelete(null);
            onDeleteGuest(person);
          }}
          title={"Delete " + pendingDelete.name + "?"}
        >
          <p>
            This permanently removes their reference photos, face data and{" "}
            {pluralize(
              deleteStats.approved + deleteStats.awaiting + deleteStats.rejected,
              "match record",
            )}{" "}
            from this event. Event photos stay in the library. This can't be undone.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function GuestMenu({
  isBusy,
  onDelete,
  onDetails,
  person,
}: {
  isBusy: boolean;
  onDelete: () => void;
  onDetails: () => void;
  person: Person;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current)
        ref.current.open = false;
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function close() {
    if (ref.current) {
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
  }
  return (
    <details
      className="guest-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      ref={ref}
    >
      <summary aria-label={"Options for " + person.name} title="Guest options">
        <MoreHorizontal aria-hidden="true" size={21} />
      </summary>
      <div className="guest-menu-items">
        <button
          onClick={() => {
            close();
            onDetails();
          }}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={16} /> Permission details
        </button>
        <button
          className="menu-danger"
          disabled={isBusy}
          onClick={() => {
            close();
            onDelete();
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" size={16} /> Delete guest
        </button>
      </div>
    </details>
  );
}

function GuestForm({
  isBusy,
  onAddGuest,
  onClose,
  submissionError,
  target,
}: {
  isBusy: boolean;
  onAddGuest: (input: AddGuestInput) => Promise<boolean>;
  onClose: () => void;
  submissionError?: string;
  target?: Person;
}) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const remaining = Math.max(0, MAX_REFERENCE_FILES - (target?.referenceCount ?? 0));
  const busy = isBusy || sending;

  function choose(incoming: File[]) {
    if (busy) return;
    const result = validateImageFiles([...files, ...incoming], { maxFiles: remaining });
    setFiles(result.accepted);
    setRejected(result.rejected);
    setFormError(null);
    setFailed(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || submittingRef.current) return;
    if (!target && !name.trim()) {
      setFormError("Enter the guest's name.");
      nameRef.current?.focus();
      return;
    }
    if (!files.length) {
      setFormError("Choose a reference photo first.");
      chooseRef.current?.focus();
      return;
    }
    if (!consent) {
      setFormError("Confirm the guest's permission before adding their photos.");
      consentRef.current?.focus();
      return;
    }
    setFormError(null);
    setFailed(false);
    setSending(true);
    submittingRef.current = true;
    try {
      const added = await onAddGuest({ files, name, personId: target?.id });
      if (added) onClose();
      else setFailed(true);
    } catch {
      setFormError("The guest couldn't be saved. Your selections are still here.");
    } finally {
      setSending(false);
      submittingRef.current = false;
    }
  }

  return (
    <Dialog
      busy={busy}
      onClose={onClose}
      title={target ? "Add a reference for " + target.name : "Add a guest"}
    >
      <form className="guest-entry-form" noValidate onSubmit={(event) => void submit(event)}>
        {!target && (
          <div className="field">
            <label htmlFor="guest-name">Guest name</label>
            <input
              autoComplete="off"
              data-initial-focus
              id="guest-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              ref={nameRef}
              disabled={busy}
              value={name}
              placeholder="Full name"
            />
          </div>
        )}
        <div className="field">
          <p className="label">
            Reference photos{" "}
            <span className="muted">
              ({remaining} {target ? "remaining" : "maximum"})
            </span>
          </p>
          <div
            className={"reference-dropzone" + (dragging ? " dropzone-active" : "")}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(Array.from(event.dataTransfer.files));
            }}
          >
            <ImagePlus aria-hidden="true" size={27} />
            <strong>
              {files.length >= remaining
                ? "Your photos are selected"
                : files.length
                  ? "Add another reference"
                  : "A clear photo of their face"}
            </strong>
            <span className="hint">JPEG or PNG, up to 15 MB each</span>
            <input
              accept={ACCEPT_ATTRIBUTE}
              aria-label="Reference photo files"
              className="visually-hidden"
              disabled={busy}
              multiple
              onChange={(event) => {
                choose(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
              ref={inputRef}
              tabIndex={-1}
              type="file"
            />
            <button
              data-initial-focus={target ? "" : undefined}
              className="button"
              disabled={busy || files.length >= remaining}
              onClick={() => inputRef.current?.click()}
              ref={chooseRef}
              type="button"
            >
              <Plus aria-hidden="true" size={16} /> Choose photos
            </button>
          </div>
          {files.length > 0 && (
            <ul aria-label="Selected reference photos" className="reference-selection">
              {files.map((file, index) => (
                <ReferenceSelection
                  disabled={busy}
                  file={file}
                  key={index}
                  onRemove={() => {
                    setFiles((current) => current.filter((_, i) => i !== index));
                    setFailed(false);
                    requestAnimationFrame(() => chooseRef.current?.focus());
                  }}
                />
              ))}
            </ul>
          )}
          <p className="hint">
            Use one front-facing photo, with an optional second angle. Only this guest should be in
            each photo.
          </p>
          {target && (
            <p className="hint">
              Previously uploaded event photos are not re-checked when you add a reference.
            </p>
          )}
          {rejected.length > 0 && (
            <ul className="issue-list" aria-label="Files that can't be used">
              {rejected.map((file, index) => (
                <li key={index}>
                  <strong>{file.name}</strong> {file.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="check consent-check">
          <input
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
            ref={consentRef}
            type="checkbox"
          />
          <span>
            This guest has agreed to photo matching, and I have permission to use these references
            for this event.
          </span>
        </label>
        {(formError || failed) && (
          <p className="field-error" role="alert">
            {formError ||
              submissionError ||
              "Nothing was added. Your selections are still here; try again."}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button-primary" disabled={busy} type="submit">
            {sending ? (
              <>
                <Spinner /> Saving guest
              </>
            ) : (
              <>
                <Check aria-hidden="true" size={17} /> {target ? "Save reference" : "Add guest"}
              </>
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({
  onClose,
  onGetLink,
}: {
  onClose: () => void;
  onGetLink: () => Promise<IntakeLink>;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);
  const getLinkRef = useRef(onGetLink);
  useEffect(() => {
    let active = true;
    getLinkRef
      .current()
      .then((result) => {
        if (active) setLink(result.intakeUrl);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, "The guest link couldn't be loaded."));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setFeedback("Link copied. Ready to share with your guests.");
    } catch {
      setFeedback("Select the link above to copy it manually.");
    }
  }
  return (
    <Dialog onClose={onClose} title="Invite your guests">
      <div className="invite-content">
        <span className="invite-symbol">
          <Link2 aria-hidden="true" size={25} />
        </span>
        <p>
          Share this signup link with your guests. They can add their name, reference photos and
          permission without creating an account.
        </p>
        {!link && !error && <Spinner label="Getting your event link..." />}
        {error && (
          <>
            <p className="field-error" role="alert">
              {error}
            </p>
            <button
              className="button"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
              type="button"
            >
              Try again
            </button>
          </>
        )}
        {link && (
          <>
            <div className="field">
              <label htmlFor="guest-invite-url">Guest signup link</label>
              <input
                id="guest-invite-url"
                onFocus={(event) => event.target.select()}
                readOnly
                value={link}
              />
            </div>
            <button className="button button-primary" onClick={() => void copy()} type="button">
              <ClipboardCopy aria-hidden="true" size={18} /> Copy invitation link
            </button>
            <a className="text-link" href={link} rel="noreferrer" target="_blank">Open guest invitation</a>
          </>
        )}
        <p className="hint" role="status">
          {feedback}
        </p>
        <p className="invite-privacy">
          <ShieldCheck aria-hidden="true" size={17} />
          <span>
            This link accepts reference photos only, not access to event photos. Share it with invited guests. You can close signup in Event details; reopening creates a new link.
          </span>
        </p>
      </div>
    </Dialog>
  );
}
