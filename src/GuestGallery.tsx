import { ArrowLeft, Download, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchGalleryDownload, fetchGuestGallery, hasConfiguredApi } from "./api";
import { ApiError, errorMessage, isAbortError } from "./errors";
import { formatDate, pluralize } from "./format";
import { Link } from "./Link";
import { createSampleData } from "./mockData";
import type { GuestGallery, GalleryPhoto } from "./types";
import { Dialog, EmptyState, PhotoImage, Spinner } from "./ui";

export function GalleryView({ gallery, preview = false, onReload, onDownload }: {
  gallery: GuestGallery; preview?: boolean; onReload?: () => void;
  onDownload: (photoId: string) => Promise<{ url: string; filename: string }>;
}) {
  const [selected, setSelected] = useState<GalleryPhoto | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  async function download(photoId: string) {
    if (downloading) return;
    setDownloading(photoId);
    setFeedback("");
    try {
      const result = await onDownload(photoId);
      const link = document.createElement("a");
      link.href = result.url; link.download = result.filename; link.rel = "noreferrer";
      document.body.append(link); link.click(); link.remove();
      setFeedback("Download requested: " + result.filename);
    } catch (error) { setFeedback(errorMessage(error, "Couldn't download this photo. Try again or contact your host.")); }
    finally { setDownloading(null); }
  }
  const currentPhoto = gallery.photos.find(photo => photo.id === selected?.id);
  return (
    <div className="gallery-view">
      <div className="gallery-heading">
        <p className="eyebrow">{gallery.eventName}</p>
        <h1>Your moments, {gallery.guestName}.</h1>
        <p>{pluralize(gallery.photos.length, "photo")} picked for you{gallery.hostName ? " by " + gallery.hostName : ""}.</p>
        {preview && <p className="gallery-sample-note">Sample gallery. Fictional guests and simulated matching.</p>}
        <div className="gallery-meta">
          <span><ShieldCheck aria-hidden="true" size={16} /> Keep this link private</span>
          {gallery.expiresAt > 0 && <span>Available until {formatDate(new Date(gallery.expiresAt * 1000).toISOString())}</span>}
          {onReload && <button className="text-button" onClick={onReload} type="button"><RefreshCw aria-hidden="true" size={16} /> Refresh photos</button>}
        </div>
      </div>
      <div aria-live="polite" role="status">{feedback && <p className="gallery-feedback">{feedback}</p>}</div>
      {gallery.photos.length === 0 ? <EmptyState title="Your host is still choosing your photos">Check back later, or contact your host below.</EmptyState> : (
        <ul className="guest-gallery-grid">{gallery.photos.map(photo => (
          <li key={photo.id}>
            <button aria-label={"View " + photo.name} className="guest-gallery-photo" onClick={() => { setFeedback(""); setSelected(photo); }} type="button"><PhotoImage alt={photo.name} src={photo.previewUrl} /></button>
            <div className="guest-gallery-caption"><span className="truncate" title={photo.name}>{photo.name}</span><button aria-label={"Download " + photo.name} className="button button-icon" disabled={downloading !== null} onClick={() => void download(photo.id)} title="Download original photo" type="button">{downloading === photo.id ? <Spinner /> : <Download aria-hidden="true" size={18} />}</button></div>
          </li>
        ))}</ul>
      )}
      <div className="gallery-contact">
        <p>These are whole event photos and may include other guests. Your reference photos and the guest list aren't shown here.</p>
        {gallery.contactEmail ? <a className="text-link" href={"mailto:" + encodeURIComponent(gallery.contactEmail) + "?subject=" + encodeURIComponent(gallery.eventName)}><Mail aria-hidden="true" size={17} /> Questions or removal requests? Contact your host</a> : <p>For questions or removal requests, contact the person who sent this gallery.</p>}
      </div>
      {currentPhoto && <Dialog onClose={() => setSelected(null)} title={currentPhoto.name}><div className="gallery-lightbox"><PhotoImage alt={currentPhoto.name} eager onReload={onReload} src={currentPhoto.previewUrl} /><button className="button button-primary" disabled={downloading !== null} onClick={() => void download(currentPhoto.id)} type="button">{downloading === currentPhoto.id ? <Spinner /> : <Download aria-hidden="true" size={18} />} Download original</button><div aria-live="polite" role="status">{feedback && <p className="gallery-feedback">{feedback}</p>}</div></div></Dialog>}
    </div>
  );
}

export function GuestGalleryPage({ search, preview = false }: { search: string; preview?: boolean }) {
  const params = new URLSearchParams(search);
  const personId = params.get("personId") ?? "";
  const token = params.get("token") ?? "";
  const [gallery, setGallery] = useState<GuestGallery | null>(() => {
    if (!preview) return null;
    const sample = createSampleData();
    const guest = sample.people.find(person => person.name === "Noah Kim")!;
    return { eventName: sample.event.name, guestName: guest.name, hostName: sample.event.hostName ?? "Sample studio", contactEmail: "", expiresAt: 0, photos: sample.photos.filter(photo => photo.matches.some(match => match.personId === guest.id)) };
  });
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(!preview);
  useEffect(() => {
    document.title = preview ? "Sample guest gallery: FaceID Events" : "Your private gallery: FaceID Events";
    if (preview) return;
    if (!hasConfiguredApi || !personId || !token) return;
    const controller = new AbortController();
    fetchGuestGallery(personId, token, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setGallery(result); setLoading(false); setError(""); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted && !isAbortError(cause)) { setGallery(null); setLoading(false); setError(cause instanceof ApiError && cause.kind === "not_found" ? "This gallery link has expired or been turned off. Ask your host for a new link." : errorMessage(cause, "Your gallery couldn't be opened.")); } });
    return () => controller.abort();
  }, [attempt, personId, token, preview]);
  function reload() { setLoading(true); setError(""); setAttempt(value => value + 1); }
  const unavailable = !preview && (!hasConfiguredApi || !personId || !token || error);
  return (
    <div className="guest-gallery-page">
      <meta name="robots" content="noindex, nofollow" />
      <header className="guest-topbar"><Link className="wordmark" href="/">FaceID Events</Link><span><ShieldCheck aria-hidden="true" size={16} /> Private gallery</span></header>
      {preview && <div className="guest-preview-notice"><span>Sample gallery. No account or uploads.</span><Link href="/demo"><ArrowLeft aria-hidden="true" size={14} /> Back to sample event</Link></div>}
      <main className="gallery-main">
        {unavailable ? <div className="guest-result"><h1>Let's check your gallery link.</h1><p role="alert">{error || "Open the gallery link your host sent you."}</p>{hasConfiguredApi && personId && token && <button className="button" onClick={reload} type="button"><RefreshCw aria-hidden="true" size={17} /> Try again</button>}</div> : loading ? <Spinner label="Opening your photos..." /> : gallery && <GalleryView gallery={gallery} onDownload={photoId => preview ? Promise.resolve({ url: gallery.photos.find(photo => photo.id === photoId)!.previewUrl, filename: gallery.photos.find(photo => photo.id === photoId)!.name }) : fetchGalleryDownload(personId, token, photoId)} onReload={preview ? undefined : reload} preview={preview} />}
      </main>
      <footer className="guest-footer">©2026 SUPREME AI VENTURES LLC</footer>
    </div>
  );
}
