import { ArrowRight, Check, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchGuestIntake, fetchGuestSubmission, hasConfiguredApi, submitUpload, type GuestIntake } from "./api";
import { ApiError, errorMessage, isAbortError } from "./errors";
import { Link } from "./Link";
import { ReferencePhotos } from "./ReferencePhotos";
import { Spinner } from "./ui";

const previewEvent: GuestIntake = { eventId: "preview", eventName: "The garden reception", hostName: "Sample studio", signupOpen: true };

function readReceipt(key: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(value) && value.length <= 2 && value.every(item => typeof item === "string") ? value : [];
  } catch { return []; }
}

export function GuestPage({ search, preview = false }: { search: string; preview?: boolean }) {
  const params = new URLSearchParams(search);
  const eventId = params.get("eventId") ?? "";
  const token = params.get("token") ?? "";
  const receiptKey = "faceid.guest.receipt:" + eventId;
  const [receipt, setReceipt] = useState<string[]>(() => preview ? [] : readReceipt(receiptKey));
  const [intake, setIntake] = useState<GuestIntake | null>(preview ? previewEvent : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(receipt.length > 0);
  const [done, setDone] = useState<{ name: string; count: number; warnings: string[] } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = preview ? "Guest preview: FaceID Events" : "Your event photos: FaceID Events";
    if (preview || !hasConfiguredApi || !eventId || !token) return;
    const controller = new AbortController();
    fetchGuestIntake(eventId, token, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setIntake(result); setLoadError(null); } })
      .catch((error: unknown) => { if (!isAbortError(error) && !controller.signal.aborted) setLoadError(error instanceof ApiError && error.kind === "not_found" ? "This invitation is no longer available. Ask your host for a new link." : errorMessage(error, "This invitation couldn't be opened.")); });
    return () => controller.abort();
  }, [eventId, token, preview, loadAttempt]);

  function rememberReceipt(ids: string[]) {
    setReceipt(ids);
    try {
      if (ids.length) sessionStorage.setItem(receiptKey, JSON.stringify(ids));
      else sessionStorage.removeItem(receiptKey);
    } catch { /* In-memory recovery remains available when browser storage is blocked. */ }
  }

  async function checkSubmission() {
    if (busy || !receipt.length) return;
    setBusy(true);
    setIssues([]);
    try {
      const result = await fetchGuestSubmission(eventId, token, receipt);
      if (result.status === "saved" || result.status === "partial") {
        setDone({ name: result.name, count: result.referenceCount, warnings: result.status === "partial" ? ["One photo was saved. Your host can help add another if needed; please don't sign up again."] : [] });
        rememberReceipt([]);
        setUncertain(false);
      } else if (result.status === "not_saved") {
        rememberReceipt([]);
        setUncertain(false);
        setIssues(["No reference photo was saved. You can choose another photo and try again."]);
      } else {
        setIssues(["Your submission is still unconfirmed. Check again shortly, or ask your host to check it. Don't submit again yet."]);
      }
    } catch (error) { setIssues([error instanceof ApiError && error.kind === "not_found" ? "This link can no longer check your submission. Contact your host before sending another photo." : errorMessage(error, "We couldn't check your submission. Contact your host before trying again.")]); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || uncertain) return;
    const guestName = name.replace(/\s+/g, " ").trim();
    if (!guestName || !files.length || !consent) {
      setIssues([!guestName ? "Enter your name." : !files.length ? "Choose a clear photo of your face." : "Please confirm your permission to continue."]);
      if (!guestName) nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setIssues([]);
    try {
      if (preview) {
        setDone({ name: guestName, count: files.length, warnings: [] });
      } else {
        const result = await submitUpload({ eventId, intakeToken: token, guestName, files, mode: "references", people: [], consentConfirmed: true, onReceipt: rememberReceipt });
        const person = result.people[0];
        rememberReceipt([]);
        if (!person) setIssues(result.warnings?.length ? result.warnings : ["No clear face was found. Try a brighter, front-facing photo."]);
        else setDone({ name: person.name, count: person.referenceCount, warnings: result.warnings ?? [] });
      }
    } catch (error) {
      const pending = error instanceof ApiError && error.uncertain;
      setUncertain(pending);
      if (!pending) rememberReceipt([]);
      setIssues([pending ? "We lost the confirmation, but your photo may already be saved. Check your submission before sending it again." : errorMessage(error, "Your photo couldn't be saved.")]);
    } finally { setBusy(false); }
  }

  const unavailable = !preview && (!hasConfiguredApi || !eventId || !token || loadError);
  const host = intake?.hostName || "Your event host";
  const contact = intake?.contactEmail;
  const contactHref = contact ? "mailto:" + encodeURIComponent(contact) + "?subject=" + encodeURIComponent(intake?.eventName ?? "") : undefined;
  return (
    <div className="guest-invitation">
      <meta name="robots" content="noindex, nofollow" />
      <header className="guest-topbar"><Link className="wordmark" href="/">FaceID Events</Link><span><ShieldCheck aria-hidden="true" size={16} /> Private event</span></header>
      {preview && <div className="guest-preview-notice"><span><strong>Guest preview.</strong> Nothing is uploaded or saved.</span><Link href="/demo">Back to sample event</Link></div>}
      <main className="guest-invitation-main" id="main" tabIndex={-1}>
        {unavailable ? (
          <div className="guest-result">
            <h1>Let's check that invitation.</h1><p role="alert">{loadError ?? "Open the signup link your host sent you."}</p>
            <div className="actions">
              {eventId && token && hasConfiguredApi && <button className="button button-primary" onClick={() => { setLoadError(null); setLoadAttempt(value => value + 1); }} type="button"><RefreshCw aria-hidden="true" size={17} /> Try again</button>}
              <Link className="button" href="/">Back to FaceID Events</Link>
            </div>
          </div>
        ) : !intake ? <Spinner label="Opening your invitation..." /> : done ? (
          <div className="guest-result">
            <span className="guest-result-mark"><Check aria-hidden="true" size={30} /></span>
            <p className="eyebrow">{intake.eventName}</p><h1>You're on the list, {done.name}.</h1>
            <p>{preview ? "In a real event, your host would now have" : "Your host now has"} {done.count} reference photo{done.count === 1 ? "" : "s"} to help find your moments.</p>
            <div className="guest-next"><h2>What happens next</h2><p>{host} checks the suggested matches and can send you a private gallery link. They send the link directly, or use their usual photo service. This signup page won't send a notification.</p></div>
            {done.warnings.map((warning, index) => <p className="field-error" key={index}>{warning}</p>)}
            <p className="hint">Changed your mind? Ask your host to remove your references and matching records.</p>
            {contactHref ? <a className="button" href={contactHref}><Mail aria-hidden="true" size={17} /> Contact {host}</a> : <p className="hint">Contact the person who sent your invitation.</p>}
            {preview && <Link className="button button-primary" href="/demo">Back to sample event <ArrowRight aria-hidden="true" size={17} /></Link>}
          </div>
        ) : (
          <div className="guest-invitation-layout">
            <section className="guest-event-context">
              <p className="eyebrow">You're invited</p><h1>{intake.eventName}</h1><p className="guest-host">With {host}</p>
              <p className="guest-intro">A little less searching.<br />More of your moments.</p>
              <p>{intake.signupOpen === false ? "For questions about your photos or reference removal, contact your host." : "Add a photo of yourself so your host can find you in the event photos. No account needed."}</p>
              <div className="guest-privacy-note"><ShieldCheck aria-hidden="true" size={20} /><div><strong>Your permission comes first.</strong><p>Your reference is private to this event's host. It stays until they delete it. You can ask them to remove it at any time.</p></div></div>
              {contactHref && <a className="text-link guest-contact" href={contactHref}><Mail aria-hidden="true" size={16} /> Contact your host</a>}
            </section>
            <section className="guest-intake-section" aria-labelledby="guest-intake-title">
              {intake.signupOpen === false && !uncertain ? (
                <div className="guest-result"><h2 id="guest-intake-title">Signup has closed</h2><p>Your host isn't accepting reference photos right now. Contact them if you need help with your photos.</p></div>
              ) : (
                <>
                  <div className="guest-form-heading"><h2 id="guest-intake-title">Find your photos</h2><span>No account needed</span></div>
                  <form className="guest-intake-form" onSubmit={event => void submit(event)} noValidate>
                    <fieldset disabled={busy || uncertain}>
                      <div className="field"><label htmlFor="signup-name"><span className="intake-step">1</span> Your name</label><input autoComplete="name" id="signup-name" maxLength={80} onChange={event => setName(event.target.value)} placeholder="Full name" ref={nameRef} required value={name} /></div>
                      <div className="field"><p className="label"><span className="intake-step">2</span> A photo of you</p><ReferencePhotos disabled={busy || uncertain} files={files} onChange={setFiles} onIssues={setIssues} /></div>
                      <div className="guest-permission"><p className="label"><span className="intake-step">3</span> Your permission</p><label className="check"><input checked={consent} onChange={event => setConsent(event.target.checked)} required type="checkbox" /><span>I agree to let {host} use these reference photos for face matching at <strong>{intake.eventName}</strong>. My host reviews each match before sharing photos, and I can ask for my references to be removed.</span></label></div>
                      <button className="button button-primary guest-submit" type="submit">{busy ? <Spinner label="Saving your photo..." /> : <>{preview ? "Try sample signup" : "I'm ready"}<ArrowRight aria-hidden="true" size={18} /></>}</button>
                    </fieldset>
                    <div aria-live="polite" role="alert">{issues.map((issue, index) => <p className="field-error" key={index}>{issue}</p>)}</div>
                  </form>
                  {uncertain && <div className="guest-recovery"><h3>Let's check before trying again.</h3><p>Your photo may already be saved. Checking won't create another signup.</p>{receipt.length > 0 && <button className="button" disabled={busy} onClick={() => void checkSubmission()} type="button"><RefreshCw aria-hidden="true" size={17} />{busy ? "Checking..." : "Check my submission"}</button>}{!contact && <p className="hint">You can also ask the person who sent your invitation to check.</p>}</div>}
                </>
              )}
            </section>
          </div>
        )}
      </main>
      <footer className="guest-footer">©2026 SUPREME AI VENTURES LLC</footer>
    </div>
  );
}
