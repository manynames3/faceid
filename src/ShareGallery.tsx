import { ClipboardCopy, ExternalLink, Link2, Lock } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "./errors";
import { formatDate } from "./format";
import { GalleryView } from "./GuestGallery";
import type { EventWorkspace, GalleryLink, Person, PhotoAsset } from "./types";
import { Dialog, Spinner } from "./ui";

export function ShareGallery({ person, event, photos, isDemo, initialLink, onClose, onCreate, onDisable, onDownload }: {
  person: Person; event: EventWorkspace; photos: PhotoAsset[]; isDemo: boolean;
  initialLink?: GalleryLink;
  onClose: () => void; onCreate?: (personId: string, photoId: string) => Promise<GalleryLink>;
  onDisable?: (personId: string) => Promise<Person>;
  onDownload: (photoId: string) => Promise<{ url: string; filename: string }>;
}) {
  const [link, setLink] = useState<GalleryLink | null>(initialLink ?? null);
  const [enabled, setEnabled] = useState(Boolean(person.galleryEnabled));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(isDemo);
  const approved = photos.filter(photo => photo.matches.some(match => match.personId === person.id && match.status === "approved"));
  async function create() {
    if (!onCreate || busy || !approved.length || person.deletionPending) return;
    setBusy(true); setError("");
    try { setLink(await onCreate(person.id, approved[0].id)); setEnabled(true); setCopied(false); }
    catch (cause) { setError(errorMessage(cause, "Couldn't create the gallery link.")); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (!onDisable || busy) return;
    setBusy(true); setError("");
    try { await onDisable(person.id); setLink(null); setEnabled(false); }
    catch (cause) { setError(errorMessage(cause, "Couldn't turn off this gallery.")); }
    finally { setBusy(false); }
  }
  return (
    <Dialog busy={busy} onClose={onClose} title={isDemo ? "Preview " + person.name + "'s gallery" : "Share " + person.name + "'s photos"}>
      <div className="share-gallery">
        {previewing ? <><GalleryView gallery={{ eventName: event.name, guestName: person.name, hostName: event.hostName ?? "", contactEmail: isDemo ? "" : event.contactEmail ?? "", expiresAt: link?.expiresAt ?? 0, photos: approved }} onDownload={onDownload} preview={isDemo} />{!isDemo && <button className="text-button" onClick={() => setPreviewing(false)} type="button">Back to sharing</button>}</> : (
          <>
            <p><strong>{approved.length} approved photos</strong> for {person.name}. Anyone with the link can view and download these whole photos, including other guests in the frame.</p>
            <p className="hint">The link lasts seven days. Later approvals appear here automatically; rejected matches are removed. Previously downloaded photos cannot be recalled.</p>
            {link ? (
              <div className="share-link-ready">
                <p className="meta">Available until {formatDate(new Date(link.expiresAt * 1000).toISOString())}</p>
                <div className="field"><label htmlFor="gallery-share-url">Guest gallery link</label><input id="gallery-share-url" onFocus={event => event.target.select()} readOnly value={link.galleryUrl} /></div>
                <div className="actions"><button className="button button-primary" onClick={() => void navigator.clipboard.writeText(link.galleryUrl).then(() => setCopied(true)).catch(() => setError("Select the link above to copy it."))} type="button"><ClipboardCopy aria-hidden="true" size={17} />{copied ? "Copied" : "Copy guest link"}</button><a className="button" href={link.galleryUrl} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={17} /> Open gallery</a></div>
                <p className="hint">Send this link privately to {person.name} using your usual email or messaging app.</p>
              </div>
            ) : (
              <>{person.deletionPending && <p className="callout callout-warn">This guest's removal is incomplete. Finish removing them from Guests before sharing photos.</p>}{enabled && <p className="callout callout-warn">A link is already active. Creating a replacement will stop the earlier link from opening.</p>}<button className="button button-primary" disabled={busy || approved.length === 0 || person.deletionPending} onClick={() => void create()} type="button">{busy ? <Spinner label="Creating..." /> : <><Link2 aria-hidden="true" size={17} />{enabled ? "Create replacement link" : "Create private guest link"}</>}</button></>
            )}
            <button className="text-button" disabled={busy} onClick={() => setPreviewing(true)} type="button">Preview the guest view</button>
            {enabled && <button className="button button-quiet-danger" disabled={busy} onClick={() => void disable()} type="button"><Lock aria-hidden="true" size={17} /> Turn off gallery link</button>}
            <p className="hint">Turning off or replacing a link blocks new gallery requests. Image links already issued may work for up to five more minutes.</p>
          </>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
