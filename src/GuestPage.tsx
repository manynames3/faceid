import { Check, UserRoundPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchGuestIntake, hasConfiguredApi, submitUpload, type GuestIntake } from "./api";
import { ApiError, errorMessage, isAbortError } from "./errors";
import { Link } from "./Link";
import { ACCEPT_ATTRIBUTE, MAX_REFERENCE_FILES, validateImageFiles } from "./uploads";
import { Spinner } from "./ui";

export function GuestPage({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const eventId = params.get("eventId") ?? "";
  const token = params.get("token") ?? "";
  const [intake, setIntake] = useState<GuestIntake | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState<{ name: string; count: number; warnings: string[] } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Guest signup: FaceID Events";
    const controller = new AbortController();
    if (hasConfiguredApi && eventId && token) {
      fetchGuestIntake(eventId, token, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setIntake(result); })
        .catch((error: unknown) => {
          if (!isAbortError(error) && !controller.signal.aborted) setLoadError(errorMessage(error, "This guest link couldn't be opened."));
        });
    }
    return () => controller.abort();
  }, [eventId, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || uncertain) return;
    const guestName = name.replace(/\s+/g, " ").trim();
    if (!guestName || files.length === 0 || !consent) {
      setIssues([!guestName ? "Enter your name." : files.length === 0 ? "Choose one or two clear JPEG or PNG photos of your face." : "Confirm your permission before submitting."]);
      if (!guestName) nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setIssues([]);
    try {
      const result = await submitUpload({ eventId, intakeToken: token, guestName, files, mode: "references", people: [], consentConfirmed: true });
      const person = result.people[0];
      if (!person) {
        setIssues(result.warnings?.length ? result.warnings : ["No clear face was found. Try a brighter, front-facing photo."]);
      } else {
        setDone({ name: person.name, count: person.referenceCount, warnings: result.warnings ?? [] });
        setFiles([]);
      }
    } catch (error) {
      const mayHaveCompleted = error instanceof ApiError && error.uncertain;
      setUncertain(mayHaveCompleted);
      setIssues([errorMessage(error, "Your signup couldn't be saved."), ...(mayHaveCompleted ? ["It may have completed. Ask your host to check your signup before sending it again."] : [])]);
    } finally {
      setBusy(false);
    }
  }

  const unavailable = !hasConfiguredApi || !eventId || !token || loadError;
  return (
    <div className="gate guest-page">
      <meta name="robots" content="noindex, nofollow" />
      <header className="gate-header"><Link className="wordmark" href="/">FaceID Events</Link><span className="muted">Guest signup</span></header>
      <main className="gate-main" id="main" tabIndex={-1}>
        {unavailable ? (
          <>
            <h1>This guest link isn't available</h1>
            <p role="alert">{loadError ?? "Ask your event host for their guest signup link."}</p>
            <Link className="button" href="/">Back to FaceID Events</Link>
          </>
        ) : !intake ? (
          <Spinner label="Opening your event…" />
        ) : done ? (
          <>
            <Check aria-hidden="true" className="guest-success" size={28} />
            <h1>You're signed up, {done.name}.</h1>
            <p>{done.count} reference photo{done.count === 1 ? "" : "s"} saved for {intake.eventName}.</p>
            <p>Your host will review possible matches and deliver photos through their usual gallery. This page doesn't provide a photo gallery or send automatic notifications.</p>
            {done.warnings.map((warning, index) => <p className="field-error" key={index}>{warning}</p>)}
            <p className="hint">To withdraw permission or remove your references, contact your event host.</p>
          </>
        ) : (
          <>
            <p className="eyebrow">{intake.eventName}</p>
            <h1>Help your host find your photos.</h1>
            <p>Send your name and a clear photo of your face. No account is needed. Your host checks every possible match before adding it to your photo list.</p>
            <form className="form guest-form" onSubmit={(event) => void submit(event)} noValidate>
              <fieldset disabled={busy || uncertain}>
                <div className="field"><label htmlFor="signup-name">Your name</label><input autoComplete="name" id="signup-name" maxLength={80} onChange={(event) => setName(event.target.value)} ref={nameRef} value={name} /></div>
                <div className="field">
                  <label htmlFor="signup-files">Photos of your face</label>
                  <input accept={ACCEPT_ATTRIBUTE} aria-describedby="signup-photo-help" id="signup-files" multiple onChange={(event) => {
                    const result = validateImageFiles(Array.from(event.target.files ?? []), { maxFiles: MAX_REFERENCE_FILES });
                    setFiles(result.accepted);
                    setIssues(result.rejected.map((item) => `${item.name}: ${item.reason}`));
                  }} type="file" />
                  <p className="hint" id="signup-photo-help">One or two JPEG or PNG photos, up to 15 MB each. Show only your face, with good light and no sunglasses. A second photo with a different pose can help.</p>
                </div>
                <label className="check"><input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" /><span>I agree to let this event's host use my reference photos for face matching at {intake.eventName}. I understand the results need human review and I can ask the host to remove my references.</span></label>
                <p className="hint">References and consent metadata are stored privately in the host's AWS-backed event workspace. They remain until the host deletes them.</p>
                <button className="button button-primary" type="submit"><UserRoundPlus aria-hidden="true" size={18} />{busy ? "Saving your signup…" : "Submit my signup"}</button>
              </fieldset>
              <div aria-live="polite" role="alert">{issues.map((issue, index) => <p className="field-error" key={index}>{issue}</p>)}</div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
