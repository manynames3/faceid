import { Check } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Person, PhotoAsset } from "./types";
import { Dialog, PhotoImage, Spinner } from "./ui";

export function AssignGuest({ photo, people, busy, error, onClose, onAssign }: {
  photo: PhotoAsset; people: Person[]; busy: boolean; error?: string;
  onClose: () => void; onAssign: (photoId: string, personId: string) => Promise<boolean>;
}) {
  const eligible = people.filter(person => person.consentStatus === "captured" && !person.deletionPending && !photo.matches.some(match => match.personId === person.id && match.status === "approved"));
  const [personId, setPersonId] = useState(eligible[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const person = eligible.find(item => item.id === personId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && confirmed && person && await onAssign(photo.id, person.id)) onClose();
  }
  return (
    <Dialog busy={busy} onClose={onClose} title="Add a guest to this photo">
      <form className="assignment-form" onSubmit={event => void submit(event)}>
        <div className="assignment-comparison">
          <figure><PhotoImage alt={photo.name} eager src={photo.previewUrl} /><figcaption>Event photo · <a href={photo.previewUrl} rel="noreferrer" target="_blank">Open original</a></figcaption></figure>
          <figure>{person?.referencePreviewUrl ? <PhotoImage alt={person.name} eager src={person.referencePreviewUrl} /> : <div className="image-fallback">No reference preview</div>}<figcaption>{person?.name ?? "Guest reference"}</figcaption></figure>
        </div>
        {eligible.length ? (
          <fieldset disabled={busy}>
            <div className="field"><label htmlFor="assign-person">Who is in this photo?</label><select id="assign-person" onChange={event => { setPersonId(event.target.value); setConfirmed(false); }} value={personId}>{eligible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <label className="check"><input checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required type="checkbox" /><span>I checked the photo and confirm {person?.name} is in it. Add it to their approved photos.</span></label>
            <p className="hint">This is your decision. It won't receive a face-matching score.</p>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button className="button button-primary" disabled={!confirmed} type="submit">{busy ? <Spinner label="Saving..." /> : <><Check aria-hidden="true" size={18} /> Add to approved</>}</button>
          </fieldset>
        ) : <p>Every guest with recorded permission is already approved in this photo. Add a consenting guest in Guests first if someone is missing.</p>}
      </form>
    </Dialog>
  );
}
