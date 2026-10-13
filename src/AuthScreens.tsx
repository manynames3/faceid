import { LogIn, UserRoundPlus } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link } from "./Link";
import type { AuthMessage } from "./useAuth";
import { Spinner } from "./ui";

function ScreenFrame({ children, title }: { children: ReactNode; title: string }) {
  useEffect(() => {
    document.title = `${title}: FaceID Events`;
  }, [title]);
  return (
    <div className="gate">
      <header className="gate-header">
        <Link className="wordmark" href="/">
          FaceID Events
        </Link>
      </header>
      <main className="gate-main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function SignInScreen({
  message,
  onSignIn,
  onSignUp,
}: {
  message: AuthMessage | null;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <ScreenFrame title="Sign in">
      <h1>Sign in to your events</h1>
      <p>
        Your guests, photos and decisions are private to your account. Sign in, or create an
        account to start your first event.
      </p>
      <div aria-live="polite" role="status">
        {message?.tone === "info" && <p className="gate-message">{message.text}</p>}
      </div>
      <div role="alert">
        {message?.tone === "error" && <p className="gate-message gate-error">{message.text}</p>}
      </div>
      <div className="actions">
        <button className="button button-primary" onClick={onSignIn} type="button">
          <LogIn aria-hidden="true" size={18} />
          Sign in
        </button>
        <button className="button" onClick={onSignUp} type="button">
          <UserRoundPlus aria-hidden="true" size={18} />
          Create account
        </button>
      </div>
      <p className="hint">
        Just looking? <Link href="/demo">Open the sample workspace</Link>. It needs no account and
        uses simulated matching.
      </p>
    </ScreenFrame>
  );
}

export function CallbackScreen() {
  return (
    <ScreenFrame title="Signing in">
      <h1>Signing you in</h1>
      <p role="status">
        <Spinner label="Finishing sign-in…" />
      </p>
    </ScreenFrame>
  );
}

export function UnavailableScreen({ reason }: { reason: "misconfigured" | "unconfigured" }) {
  return (
    <ScreenFrame title="Workspace unavailable">
      <h1>
        {reason === "misconfigured"
          ? "Sign-in isn't set up for this site"
          : "The live workspace isn't connected"}
      </h1>
      <p role="alert">
        {reason === "misconfigured"
          ? "This site is connected to a service but has no sign-in configured, so it won't open a workspace without one. The site owner needs to finish the sign-in setup."
          : "This build isn't connected to the event service, so there's no live workspace to open."}
      </p>
      <div className="actions">
        <Link className="button button-primary" href="/demo">
          Open the sample workspace
        </Link>
        <Link className="button" href="/">
          Back to the site
        </Link>
      </div>
    </ScreenFrame>
  );
}

export function NotFoundScreen() {
  return (
    <ScreenFrame title="Page not found">
      <h1>Page not found</h1>
      <p>That address doesn't exist.</p>
      <div className="actions">
        <Link className="button button-primary" href="/">
          Go to the home page
        </Link>
      </div>
    </ScreenFrame>
  );
}
