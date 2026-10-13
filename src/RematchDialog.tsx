import { Check, Search, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "./errors";
import type { Person, PhotoAsset, RematchResult } from "./types";
import { Dialog, PhotoImage, Spinner } from "./ui";

type Result = { photoId: string; text: string; failed: boolean; requestId: string; uncertain: boolean };
export function RematchDialog({ people, photos, isDemo, initialGuestId, onClose, onRematch, onRefresh }: {
  people: Person[]; photos: PhotoAsset[]; isDemo: boolean; onClose: () => void;
  initialGuestId?: string;
  onRematch: (photoId: string, personId: string, requestId: string) => Promise<RematchResult>;
  onRefresh: () => void;
}) {
  const guests = people.filter(person => person.consentStatus === "captured" && !person.deletionPending && person.referenceCount > 0);
  const [personId, setPersonId] = useState(initialGuestId || guests[0]?.id || "");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const eligible = photos.filter(photo => !photo.matches.some(match => match.personId === personId && (match.status === "approved" || match.status === "rejected")));
  const person = guests.find(item => item.id === personId);
  async function run(retries?: Result[]) {
    if (busy || !person) return;
    const tasks = retries ? retries.map(item => ({ ...item, requestId: item.uncertain ? item.requestId : crypto.randomUUID() })) : selected.map(photoId => ({ photoId, requestId: crypto.randomUUID() }));
    setBusy(true);
    if (!retries) setResults([]);
    for (let index = 0; index < tasks.length && alive.current; index++) {
      const task = tasks[index];
      setProgress(`Checking ${index + 1} of ${tasks.length}`);
      let result: Result;
      try {
        const response = await onRematch(task.photoId, personId, task.requestId);
        result = { ...task, failed: false, uncertain: false, text: response.outcome === "suggested" ? "Suggested match ready for review" : response.outcome === "kept_decision" ? "Earlier decision kept" : "No additional match found" };
      } catch (error) {
        const uncertain = error instanceof ApiError && (error.uncertain || error.status === 409);
        result = { ...task, failed: true, uncertain, text: errorMessage(error, "Couldn't check this photo.") };
      }
      if (alive.current) setResults(current => [...current.filter(item => item.photoId !== task.photoId), result]);
    }
    if (alive.current) { setBusy(false); setProgress(""); }
  }
  const failed = results.filter(result => result.failed);
  return (
    <Dialog busy={busy} onClose={onClose} title="Find a guest in existing photos">
      <div className="rematch-form">
        <p>Use this after adding a guest or improving their references. Earlier approvals and rejections stay as they are.</p>
        {isDemo && <p className="hint">Sample results are simulated. No face analysis runs.</p>}
        <div className="field"><label htmlFor="rematch-person">Guest to find</label><select disabled={busy} id="rematch-person" onChange={event => { setPersonId(event.target.value); setSelected([]); setResults([]); }} value={personId}>{guests.map(guest => <option key={guest.id} value={guest.id}>{guest.name}</option>)}</select></div>
        {!guests.length ? <p>Add a guest reference and record their permission first.</p> : !eligible.length ? <p>All photos already have a decision for this guest.</p> : (
          <>
            <div className="rematch-selection-head"><span>{selected.length} selected · up to 50 per search</span><button className="text-button" disabled={busy} onClick={() => setSelected(selected.length ? [] : eligible.slice(0, 50).map(photo => photo.id))} type="button">{selected.length ? "Clear selection" : "Select first " + Math.min(50, eligible.length)}</button></div>
            <ul className="rematch-photos">{eligible.map(photo => <li key={photo.id}><label><input checked={selected.includes(photo.id)} disabled={busy || (!selected.includes(photo.id) && selected.length >= 50)} onChange={event => setSelected(current => event.target.checked ? [...current, photo.id] : current.filter(id => id !== photo.id))} type="checkbox" /><PhotoImage alt="" src={photo.previewUrl} /><span>{photo.name}</span></label></li>)}</ul>
            <p className="hint">{selected.length} photos using up to {Math.min(person?.referenceCount ?? 0, 2)} references each. {isDemo ? "This sample has no cloud cost." : "More photos and references require more processing. Completed results stay in your event."}</p>
            <button className="button button-primary" disabled={busy || !selected.length || results.length > 0} onClick={() => void run()} type="button">{busy ? <Spinner label={progress} /> : <><Search aria-hidden="true" size={18} /> Check selected photos</>}</button>
          </>
        )}
        <div aria-live="polite">{results.length > 0 && <ul className="rematch-results">{results.map(result => <li key={result.photoId}>{!result.failed && <Check aria-hidden="true" size={16} />}<span><strong>{photos.find(photo => photo.id === result.photoId)?.name}</strong><span className={result.failed ? "field-error" : "meta"}>{result.text}</span></span></li>)}</ul>}</div>
        {!busy && failed.length > 0 && <div className="actions"><button className="button" onClick={onRefresh} type="button"><RefreshCw aria-hidden="true" size={17} /> Refresh results</button><button className="button" onClick={() => void run(failed)} type="button">Check failed requests</button></div>}
        {!busy && results.length > 0 && <button className="button" onClick={onClose} type="button">Done</button>}
      </div>
    </Dialog>
  );
}
