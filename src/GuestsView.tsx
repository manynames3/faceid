import { ClipboardCopy, Link2, Trash2, UserRoundPlus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { formatDate, pluralize } from "./format";
import { errorMessage } from "./errors";
import type { IntakeLink } from "./api";
import type { GuestStats } from "./library";
import type { AddGuestInput } from "./useWorkspace";
import type { Person } from "./types";
import { ACCEPT_ATTRIBUTE, formatBytes, MAX_REFERENCE_FILES, validateImageFiles } from "./uploads";
import type { RejectedFile } from "./uploads";
import { Avatar, ConfirmDialog, EmptyState } from "./ui";

const noStats: GuestStats = { approved: 0, awaiting: 0, rejected: 0 };

function consentText(person: Person) {
  if (person.consentStatus !== "captured") {
    return { ok: false, text: "Consent not recorded" };
  }
  const who =
    person.consentSource === "guest_submitted" ? "submitted by the guest" : "confirmed by you";
  const when = formatDate(person.consentCapturedAt);
  return { ok: true, text: `Consent ${who}${when ? ` on ${when}` : ""}` };
}

export function GuestsView({
  isBusy,
  onAddGuest,
  onDeleteGuest,
  onGetIntakeLink,
  people,
  stats,
}: {
  isBusy: boolean;
  onAddGuest: (input: AddGuestInput) => Promise<boolean>;
  onDeleteGuest: (person: Person) => void;
  onGetIntakeLink?: () => Promise<IntakeLink>;
  people: Person[];
  stats: Map<string, GuestStats>;
}) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [target, setTarget] = useState<Person | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Person | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const remainingReferences = MAX_REFERENCE_FILES - (target?.referenceCount ?? 0);
  const [intakeLink, setIntakeLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);

  async function getGuestLink() {
    if (!onGetIntakeLink || linkBusy) return;
    setLinkBusy(true);
    setLinkFeedback(null);
    try {
      const result = await onGetIntakeLink();
      setIntakeLink(result.intakeUrl);
    } catch (error) {
      setLinkFeedback(errorMessage(error, "The guest link couldn't be opened."));
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyGuestLink() {
    if (!intakeLink) return;
    try {
      await navigator.clipboard.writeText(intakeLink);
      setLinkFeedback("Guest signup link copied.");
    } catch {
      setLinkFeedback("Select the link below to copy it.");
    }
  }

  function chooseFiles(list: FileList | null) {
    const result = validateImageFiles(Array.from(list ?? []), { maxFiles: remainingReferences });
    setFiles(result.accepted);
    setRejected(result.rejected);
    setFormError(null);
  }

  function resetForm() {
    setName("");
    setFiles([]);
    setRejected([]);
    setConsent(false);
    setTarget(null);
    setFormError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function startAddingReferences(person: Person) {
    resetForm();
    setTarget(person);
    formRef.current?.scrollIntoView({ block: "center" });
    requestAnimationFrame(() => fileInputRef.current?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!target && name.trim().length === 0) {
      setFormError("Enter the guest's name.");
      nameInputRef.current?.focus();
      return;
    }
    if (files.length === 0) {
      setFormError("Choose one or two JPEG or PNG reference photos.");
      fileInputRef.current?.focus();
      return;
    }
    if (!consent) {
      setFormError("Confirm the guest has agreed before adding their photos.");
      return;
    }

    setFormError(null);
    const added = await onAddGuest({ files, name, personId: target?.id });
    if (added) {
      resetForm();
    }
  }

  const deleteStats = pendingDelete ? (stats.get(pendingDelete.id) ?? noStats) : noStats;
  const deleteMatchCount = deleteStats.approved + deleteStats.awaiting + deleteStats.rejected;

  return (
    <div className="view guests-view">
      <section className="section guest-invite" aria-labelledby="guest-invite-title">
        <h2 className="section-title" id="guest-invite-title">Let guests sign up</h2>
        <p>Guests can send their name, reference photos and permission from a separate page. No account is needed.</p>
        <div className="actions">
          <button className="button button-primary" disabled={isBusy || linkBusy || !onGetIntakeLink} onClick={() => void getGuestLink()} type="button"><Link2 aria-hidden="true" size={18} />{linkBusy ? "Getting guest link…" : "Get guest signup link"}</button>
          {intakeLink && <button className="button" onClick={() => void copyGuestLink()} type="button"><ClipboardCopy aria-hidden="true" size={18} />Copy link</button>}
        </div>
        {!onGetIntakeLink && <p className="hint">Guest signup links are available in live events, not the sample workspace.</p>}
        {intakeLink && <div className="field"><label htmlFor="guest-invite-url">Guest signup link</label><input id="guest-invite-url" readOnly value={intakeLink} onFocus={(event) => event.target.select()} /><p className="hint">This link accepts signups, not gallery access. It doesn't expire automatically; share it only with your invited guests.</p></div>}
        <p className="hint" role="status">{linkFeedback}</p>
      </section>
      <form className="panel form" onSubmit={(event) => void submit(event)} ref={formRef} noValidate>
        <h2 className="panel-title">
          {target ? `Add reference photos for ${target.name}` : "Add a guest"}
        </h2>

        {!target && (
          <div className="field">
            <label htmlFor="guest-name">Guest name</label>
            <input
              autoComplete="off"
              id="guest-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              ref={nameInputRef}
              value={name}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="guest-files">
            Reference photos <span className="muted">
              ({target ? `${remainingReferences} remaining` : "1 or 2"}, JPEG or PNG, up to 15 MB each)
            </span>
          </label>
          <input
            accept={ACCEPT_ATTRIBUTE}
            aria-describedby="guest-files-help"
            id="guest-files"
            multiple
            onChange={(event) => chooseFiles(event.target.files)}
            ref={fileInputRef}
            type="file"
          />
          <p className="hint" id="guest-files-help">
            Use clear, front-facing photos with only this guest in them. Only the first two
            references per guest are used for matching, so more won't help.
            {target &&
              " Photos you've already uploaded are not re-checked against new references."}
          </p>
          {files.length > 0 && (
            <ul className="file-list" aria-label="Selected reference photos">
              {files.map((file) => (
                <li key={`${file.name}:${file.size}`}>
                  <span className="truncate">{file.name}</span>
                  <span className="muted">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {rejected.length > 0 && (
            <ul className="issue-list" aria-label="Files that can't be used">
              {rejected.map((item, index) => (
                <li key={`${item.name}:${index}`}>
                  <strong className="truncate">{item.name}</strong> {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="check">
          <input
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            type="checkbox"
          />
          <span>
            This guest has agreed to have their photos matched, and I'm allowed to use their
            reference photos for this event.
          </span>
        </label>

        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}

        <div className="actions">
          <button className="button button-primary" disabled={isBusy} type="submit">
            <UserRoundPlus aria-hidden="true" size={18} />
            {target ? "Add references" : "Add guest"}
          </button>
          {(target || files.length > 0 || name) && (
            <button className="button" disabled={isBusy} onClick={resetForm} type="button">
              {target ? "Cancel" : "Clear"}
            </button>
          )}
        </div>
      </form>

      <section aria-labelledby="guest-list-title" className="section">
        <h2 className="section-title" id="guest-list-title">
          Guests <span className="muted">{people.length}</span>
        </h2>

        {people.length === 0 ? (
          <EmptyState title="No guests yet">
            Invite guests with the signup link, or add their references yourself. At least one
            guest needs a reference photo before event photos can be matched.
          </EmptyState>
        ) : (
          <ul className="guest-list">
            {people.map((person) => {
              const counts = stats.get(person.id) ?? noStats;
              const consentInfo = consentText(person);
              return (
                <li className="guest-row" key={person.id}>
                  <Avatar person={person} size="lg" />
                  <div className="guest-main">
                    <h3 className="truncate">{person.name}</h3>
                    <p className={consentInfo.ok ? "meta" : "meta meta-warn"}>{consentInfo.text}</p>
                    <p className="meta">
                      {pluralize(person.referenceCount, "reference photo")}
                      {person.referenceCount > MAX_REFERENCE_FILES && " (first 2 used)"}
                      {" · "}
                      {counts.awaiting} awaiting review · {counts.approved} approved
                    </p>
                  </div>
                  <div className="guest-actions">
                    {person.referenceCount < MAX_REFERENCE_FILES ? (
                      <button
                        className="button"
                        disabled={isBusy}
                        onClick={() => startAddingReferences(person)}
                        type="button"
                      >
                        Add references
                      </button>
                    ) : (
                      <span className="meta">References complete</span>
                    )}
                    <button
                      aria-label={`Delete ${person.name}`}
                      className="button button-quiet-danger"
                      disabled={isBusy}
                      onClick={() => setPendingDelete(person)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={17} />
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          confirmLabel="Delete guest"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const person = pendingDelete;
            setPendingDelete(null);
            onDeleteGuest(person);
          }}
          title={`Delete ${pendingDelete.name}?`}
        >
          <p>
            This permanently removes their reference photos, their face data and{" "}
            {pluralize(deleteMatchCount, "match record")} from this event. Event photos stay in the
            library. This can't be undone.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
