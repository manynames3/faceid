import { useCallback, useEffect, useState } from "react";
import {
  clearStoredSession,
  completeSignInFromUrl,
  getStoredSession,
  hasAuthCallbackParams,
  hasConfiguredAuth,
  signOut,
  startSignIn,
  startSignUp,
  type AuthSession,
} from "./auth";
import { errorMessage } from "./errors";
import { navigate } from "./router";

export type AuthMessage = { text: string; tone: "error" | "info" };

/** Owns the Cognito session: finishes the redirect, and signs out when it expires. */
export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession());
  // Read once: finishing sign-in clears the URL, and StrictMode re-runs the
  // effect below, so a second URL check would wrongly see "no callback".
  const [arrivedFromRedirect] = useState(() => hasAuthCallbackParams());
  const [isChecking, setIsChecking] = useState(arrivedFromRedirect);
  const [message, setMessage] = useState<AuthMessage | null>(null);

  useEffect(() => {
    if (!hasConfiguredAuth || !arrivedFromRedirect) {
      return;
    }

    let isCancelled = false;

    completeSignInFromUrl()
      .then((next) => {
        if (isCancelled) {
          return;
        }
        setSession(next);
        // The redirect lands on the site root; the workspace lives at /app.
        navigate("/app", { replace: true });
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        setMessage({ text: errorMessage(error, "Sign-in failed."), tone: "error" });
        navigate("/app", { replace: true });
      })
      .finally(() => {
        if (!isCancelled) {
          setIsChecking(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [arrivedFromRedirect]);

  const expire = useCallback((text = "Your session expired. Sign in again to continue.") => {
    clearStoredSession();
    setSession(null);
    setMessage({ text, tone: "info" });
  }, []);

  // Tokens expire while the tab is open; send the user back to sign-in then.
  useEffect(() => {
    if (!session) {
      return;
    }

    const remaining = session.expiresAt - Date.now();
    const timer = window.setTimeout(() => expire(), Math.max(0, Math.min(remaining, 2 ** 31 - 1)));
    const check = () => {
      if (document.visibilityState === "visible" && session.expiresAt <= Date.now()) {
        expire();
      }
    };
    document.addEventListener("visibilitychange", check);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [expire, session]);

  const begin = useCallback((start: () => Promise<void>, fallback: string) => {
    setMessage(null);
    start().catch((error: unknown) => {
      setMessage({ text: errorMessage(error, fallback), tone: "error" });
    });
  }, []);

  return {
    expire,
    isChecking,
    message,
    session,
    dismissMessage: () => setMessage(null),
    signIn: () => begin(startSignIn, "Sign-in failed."),
    signOut,
    signUp: () => begin(startSignUp, "Sign-up failed."),
  };
}
