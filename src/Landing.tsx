import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "./Link";
import { samplePortraits } from "./mockData";

const sheet = [
  {
    ...samplePortraits.noah,
    caption: "arrivals-0412.jpg",
    guest: "Noah Kim",
    score: "91.7%",
    status: "Awaiting your decision",
  },
  {
    ...samplePortraits.ava,
    caption: "garden-0022.jpg",
    guest: "Ava Morales",
    score: "84.6%",
    status: "Needs a closer look",
  },
  {
    ...samplePortraits.maya,
    caption: "stage-portrait-0118.jpg",
    guest: "Maya Johnson",
    score: "96.2%",
    status: "Awaiting your decision",
  },
];

const steps = [
  {
    title: "Add your guest list",
    body: "Create a private event and send the guest signup link. Guests submit their names, one or two clear reference photos and permission. You can also add references yourself.",
  },
  {
    title: "Upload photos and check the matches",
    body: "Drop in your JPEG or PNG frames. Compare each suggested match with the guest's reference, then approve or reject it. You keep the final say.",
  },
  {
    title: "Hand off approved photo lists",
    body: "Export a CSV or copy each guest's filenames. Use the lists with your existing delivery process. Pending and rejected matches stay out.",
  },
];

const fits = [
  {
    event: "Weddings and rehearsal dinners",
    why: "A known guest list, hundreds of frames, and relatives asking where their photos are.",
  },
  {
    event: "Galas, conferences and offsites",
    why: "Attendees you can name ahead of time, with portraits you already have on file.",
  },
  {
    event: "Private dinners and reunions",
    why: "A smaller guest list, plenty of candid moments, and people who want their own photos.",
  },
  {
    event: "Milestone birthdays and private parties",
    why: "A smaller group, where every guest still expects their own set.",
  },
];

const faqs = [
  {
    q: "Who is this for?",
    a: "Photographers and hosts of small private events who know their guests and can obtain their permission and reference photos. It helps sort a shoot by guest; it isn't an access-control or surveillance system.",
  },
  {
    q: "What happens after I create an account?",
    a: "Sign in, create your event, then add your first guest with reference photos and permission. Upload a few event photos to test the results before working through the rest of your shoot.",
  },
  {
    q: "Why not keep sorting by hand or use a spreadsheet?",
    a: "A spreadsheet can track filenames, but you still have to find each guest in every frame. Here, matching proposes candidates and your review builds the approved list. For very small shoots, manual sorting may be enough.",
  },
  {
    q: "Why not use ChatGPT, Zapier or n8n?",
    a: "This workspace keeps an event's guest references, photo candidates, review decisions and approved lists together. A generic chat isn't that workflow. Automation tools could connect the same services, but you'd still need to build and maintain intake, review, permissions and deletion yourself.",
  },
  {
    q: "Do guests upload their own photos?",
    a: "Yes. Send your event's guest signup link so guests can enter their name, submit reference photos and confirm permission without an account. You can also add references yourself after confirming they've agreed.",
  },
  {
    q: "How do guests get their photos?",
    a: "You export the approved matches as a CSV, or copy the filenames guest by guest, and deliver through your existing process. FaceID Events doesn't host guest galleries or create download links.",
  },
  {
    q: "How accurate is the matching?",
    a: "Each candidate comes back with a matching score. That is an estimate, and results depend on the references and on the photos themselves. There's no accuracy guarantee, which is why every match waits for your approval.",
  },
  {
    q: "What files can I use?",
    a: "JPEG and PNG, up to 15 MB each. Start with a small event: the default matching limit is 50 guests. Use one or two clear reference photos per guest, including a front-facing shot; only the first two are used for matching.",
  },
  {
    q: "Can I remove someone?",
    a: "Yes. Deleting a guest removes their reference photos, face data and match records. Deleting a photo removes it and its matches.",
  },
  {
    q: "Is the sample workspace real?",
    a: "No. It runs entirely in your browser with made-up names and scores, so you can try the whole flow without an account. Nothing is analysed or uploaded, and it resets when you leave.",
  },
];

export function Landing({ signedIn }: { signedIn: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    document.title = "FaceID Events: event photo delivery, made personal";
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const accountLabel = signedIn ? "Open workspace" : "Start an event";

  return (
    <div className="landing">
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <header className="site-header">
        <div className="site-header-inner">
          <Link className="wordmark" href="/" onClick={closeMenu}>
            FaceID Events
          </Link>
          <button
            aria-controls="site-nav"
            aria-expanded={menuOpen}
            className="menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuButtonRef}
            type="button"
          >
            {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
            <span>Menu</span>
          </button>
          <nav aria-label="Primary" className="site-nav" data-open={menuOpen} id="site-nav">
            <a href="#workflow" onClick={closeMenu}>
              Workflow
            </a>
            <a href="#workspace" onClick={closeMenu}>
              Inside the workspace
            </a>
            <a href="#privacy" onClick={closeMenu}>
              Privacy
            </a>
            {!signedIn && (
              <Link href="/app" onClick={closeMenu}>Log in</Link>
            )}
            <Link className="button button-primary nav-cta" href="/app" onClick={closeMenu}>
              {accountLabel}
            </Link>
          </nav>
        </div>
      </header>

      <main id="content">
        <section aria-labelledby="hero-title" className="hero">
          <div className="hero-photos">
            <img alt="" decoding="async" fetchPriority="high" src="/images/event-hero.jpg" />
          </div>
          <div className="hero-scrim" />
          <div className="hero-copy">
            <p className="eyebrow eyebrow-light">For event photographers and private hosts</p>
            <h1 id="hero-title">Event photos, sorted by guest.</h1>
            <p className="hero-lede">
              Spend less of the evening sorting your shoot. Find possible matches, check the
              faces, and hand off each guest's approved photo list.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/app">
                Start an event
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link className="button button-light button-large" href="/demo">
                Open the sample workspace
              </Link>
            </div>
            <p className="hero-note">
              Private beta. The sample workspace uses simulated matching and needs no account.
            </p>
          </div>
          <a className="hero-hint" href="#problem">
            How it works
            <ChevronDown aria-hidden="true" size={18} />
          </a>
        </section>

        <section aria-labelledby="problem-title" className="band band-intro" id="problem">
          <div className="wrap split">
            <div>
              <p className="eyebrow">The problem</p>
              <h2 id="problem-title">Hundreds of frames. Dozens of guests. Everyone wants theirs.</h2>
              <p className="section-lede">
                The editing is done. Then come the messages: "Did you get any photos of us?"
                You scan the same shoot again, note filenames, and repeat for the next guest.
              </p>
            </div>
            <ul className="plain-list">
              <li>
                <strong>Stop scrolling for faces.</strong> Each photo is compared against your
                guests so you start from candidates, not from the full gallery.
              </li>
              <li>
                <strong>Keep the final say.</strong> Only your approvals reach the handoff list,
                and you can correct a decision later.
              </li>
              <li>
                <strong>Hand off a list, not a folder dump.</strong> Get the approved photos per
                guest, ready for the way you already deliver.
              </li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="workflow-title" className="band band-tint" id="workflow">
          <div className="wrap">
            <p className="eyebrow">Workflow</p>
            <h2 id="workflow-title">Three steps from shoot to guest list</h2>
            <ol className="steps">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span aria-hidden="true" className="step-number">
                    {index + 1}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="workspace-title" className="band" id="workspace">
          <div className="wrap">
            <p className="eyebrow">Inside the workspace</p>
            <h2 id="workspace-title">One tab for each job: Guests, Photos, Review, Deliver</h2>
            <p className="section-lede">
              This is the sample workspace. Every name and score below is simulated, so you can see
              how review works without an account.
            </p>

            <ul aria-label="Sample contact sheet" className="contact-sheet">
              {sheet.map((photo) => (
                <li key={photo.src}>
                  <Link href="/demo">
                    <span className="sheet-frame">
                      <img alt={photo.alt} decoding="async" loading="lazy" src={photo.src} />
                      <span className="sheet-flag">Simulated</span>
                    </span>
                    <span className="sheet-caption">
                      <strong>{photo.guest}</strong>
                      <span>
                        Score {photo.score} · {photo.status}
                      </span>
                      <span className="sheet-file">{photo.caption}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <dl className="tab-notes">
              <div>
                <dt>Guests</dt>
                <dd>Guest signup links, named references and a permission record for each guest.</dd>
              </div>
              <div>
                <dt>Photos</dt>
                <dd>Drag in event photos. Progress is shown per photo, and failed ones can be retried.</dd>
              </div>
              <div>
                <dt>Review</dt>
                <dd>Open a match full size beside the guest's reference, then approve or reject it.</dd>
              </div>
              <div>
                <dt>Deliver</dt>
                <dd>Export approved matches as a CSV or copy filenames, guest by guest.</dd>
              </div>
            </dl>

            <Link className="button button-primary" href="/demo">
              Open the sample workspace
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>

        <section aria-labelledby="fit-title" className="band band-tint">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Best fit</p>
              <h2 id="fit-title">Events where you know who's coming</h2>
              <p className="section-lede">
                Matching works from reference photos, so it suits guest lists you can name ahead of
                time. It's a poor fit for open crowds, or for frames where faces are small, turned
                away or covered.
              </p>
            </div>
            <ul className="fit-list">
              {fits.map((fit) => (
                <li key={fit.event}>
                  <h3>{fit.event}</h3>
                  <p>{fit.why}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="privacy-title" className="band" id="privacy">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Privacy</p>
              <h2 id="privacy-title">Plain answers about guest photos</h2>
              <p className="section-lede">
                Faces are sensitive. These are the controls that exist today, and the limits.
              </p>
            </div>
            <dl className="facts-list">
              <div>
                <dt>Stored privately</dt>
                <dd>
                  Photos sit in private cloud storage, separated by account and by event, and are
                  shown to you through short-lived links.
                </dd>
              </div>
              <div>
                <dt>Consent first</dt>
                <dd>
                  Guests confirm permission on their signup page. For references you add yourself,
                  the workspace asks you to attest that they've agreed. The source and time are recorded.
                </dd>
              </div>
              <div>
                <dt>You approve every match</dt>
                <dd>
                  A matching score is an estimate, not proof of who is in a photo. Nothing reaches
                  the delivery list until you approve it.
                </dd>
              </div>
              <div>
                <dt>Delete on request</dt>
                <dd>
                  Deleting a guest removes their reference photos, face data and match records.
                  Deleting a photo removes it and its matches.
                </dd>
              </div>
              <div>
                <dt>Nothing expires on its own</dt>
                <dd>
                  Data stays until you delete it, so remove an event's guests and photos when the
                  job is finished.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="access-title" className="band band-tint">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Access</p>
              <h2 id="access-title">In private beta</h2>
            </div>
            <div>
              <p className="section-lede">
                Create an account to start a real event, or look around the sample workspace first.
                Pricing isn't published yet.
              </p>
              <div className="hero-actions">
                <Link className="button button-primary" href="/app">
                  {accountLabel}
                </Link>
                <Link className="button" href="/demo">
                  Open the sample workspace
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="band" id="faq">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Questions</p>
              <h2 id="faq-title">Before you start</h2>
            </div>
            <div className="faq">
              {faqs.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="final-title" className="band band-dark">
          <div className="wrap final">
            <h2 id="final-title">Give every guest their own set.</h2>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/app">
                {accountLabel}
              </Link>
              <Link className="button button-light button-large" href="/demo">
                Open the sample workspace
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-inner">
          <p>©2026 SUPREME AI VENTURES LLC</p>
          <nav aria-label="Footer">
            <a href="#workflow">Workflow</a>
            <a href="#privacy">Privacy</a>
            <Link href="/demo">Sample workspace</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
