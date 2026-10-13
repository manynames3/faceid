import { Check, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { EventSettings, EventWorkspace } from "./types";
import { Dialog } from "./ui";

export function EventDetails({ event, busy, error, onClose, onSave }: {
  event: EventWorkspace; busy: boolean; error?: string; onClose: () => void;
  onSave: (settings: EventSettings) => Promise<boolean>;
}) {
  const [name, setName] = useState(event.name);
  const [hostName, setHostName] = useState(event.hostName ?? "");
  const [contactEmail, setContactEmail] = useState(event.contactEmail ?? "");
  const [signupOpen, setSignupOpen] = useState(event.signupOpen !== false);
  async function submit(form: FormEvent) {
    form.preventDefault();
    if (await onSave({ name: name.trim(), hostName: hostName.trim(), contactEmail: contactEmail.trim(), ...(signupOpen !== (event.signupOpen !== false) ? { signupOpen } : {}) })) onClose();
  }
  return (
    <Dialog busy={busy} onClose={onClose} title="Event details">
      <form className="event-details-form" onSubmit={event => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="field"><label htmlFor="event-name">Event name</label><input data-initial-focus id="event-name" maxLength={80} minLength={2} onChange={event => setName(event.target.value)} required value={name} /></div>
          <div className="field"><label htmlFor="event-host">Host or studio name</label><input autoComplete="organization" id="event-host" maxLength={80} onChange={event => setHostName(event.target.value)} placeholder="Who is inviting your guests?" required={signupOpen} value={hostName} /></div>
          <div className="field"><label htmlFor="event-contact">Guest contact email</label><input autoComplete="email" id="event-contact" maxLength={254} onChange={event => setContactEmail(event.target.value)} placeholder="hello@yourstudio.com" required={signupOpen} type="email" value={contactEmail} /><p className="hint"><Mail aria-hidden="true" size={14} /> Shown on your guest invitation for questions and removal requests.</p></div>
          <label className="check signup-toggle"><input checked={signupOpen} onChange={event => setSignupOpen(event.target.checked)} type="checkbox" /><span><strong>Accept guest signups</strong><span className="hint">Close signup when your guest list is ready. Existing guest records are kept.</span></span></label>
          {signupOpen && event.signupOpen === false && <p className="callout callout-warn">Reopening creates a new invitation link. Previously shared links will no longer work.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button className="button" onClick={onClose} type="button">Cancel</button><button className="button button-primary" type="submit"><Check aria-hidden="true" size={17} />{busy ? "Saving..." : "Save details"}</button></div>
        </fieldset>
      </form>
    </Dialog>
  );
}
