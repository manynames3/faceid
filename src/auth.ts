const rawAuthDomain = import.meta.env.VITE_AUTH_DOMAIN as string | undefined;
const authDomain = rawAuthDomain?.replace(/\/$/, "");
const authClientId = import.meta.env.VITE_AUTH_CLIENT_ID as string | undefined;
const authRedirectUri =
  (import.meta.env.VITE_AUTH_REDIRECT_URI as string | undefined) ??
  window.location.origin;

const tokenStorageKey = "face-sorter-auth-session";
const verifierStorageKey = "face-sorter-pkce-verifier";
const stateStorageKey = "face-sorter-oauth-state";

export const hasConfiguredAuth = Boolean(authDomain && authClientId);

export type AuthSession = {
  accessToken: string;
  email?: string;
  expiresAt: number;
  idToken: string;
  userId?: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
};

export function getStoredSession(): AuthSession | null {
  if (!hasConfiguredAuth) {
    return null;
  }

  try {
    const rawValue = sessionStorage.getItem(tokenStorageKey);
    if (!rawValue) {
      return null;
    }

    const session = JSON.parse(rawValue) as AuthSession;
    if (
      typeof session.idToken !== "string" || !session.idToken ||
      typeof session.accessToken !== "string" || !session.accessToken ||
      !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()
    ) {
      clearStoredSession();
      return null;
    }

    return session;
  } catch {
    clearStoredSession();
    return null;
  }
}

/** True when the URL is a Cognito redirect (a code or an error) rather than a normal visit. */
export function hasAuthCallbackParams(search: string = window.location.search) {
  if (!hasConfiguredAuth) {
    return false;
  }
  const params = new URLSearchParams(search);
  return params.has("code") || params.has("error");
}

// The authorization code can be exchanged only once. React StrictMode runs
// effects twice in development, so every caller on this page load shares one
// exchange instead of racing a second request that would fail.
let completion: Promise<AuthSession | null> | null = null;

export function completeSignInFromUrl(): Promise<AuthSession | null> {
  if (!completion) {
    const current = runSignInCompletion();
    completion = current;
    const release = () => {
      // Keep the shared result through the synchronous double-invoke, then let
      // a later visit start fresh.
      setTimeout(() => {
        if (completion === current) {
          completion = null;
        }
      }, 0);
    };
    current.then(release, release);
  }
  return completion;
}

async function runSignInCompletion(): Promise<AuthSession | null> {
  if (!hasConfiguredAuth || !authDomain || !authClientId) {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error_description") ?? params.get("error");
  const code = params.get("code");

  if (authError) {
    discardSignInAttempt();
    throw new Error(`Sign-in failed: ${authError}`);
  }

  if (!code) {
    return getStoredSession();
  }

  const verifier = sessionStorage.getItem(verifierStorageKey);
  const expectedState = sessionStorage.getItem(stateStorageKey);
  const actualState = params.get("state");

  if (!verifier || !expectedState || expectedState !== actualState) {
    discardSignInAttempt();
    throw new Error("This sign-in link has expired or was already used. Start sign-in again.");
  }

  // Cleared up front so a reload or back-navigation can't replay the code.
  clearAuthQueryParams();

  try {
    const tokenResponse = await fetch(`${authDomain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: authClientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: authRedirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(
        `Sign-in couldn't be completed (status ${tokenResponse.status}). Start sign-in again.`,
      );
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokens.id_token || !tokens.access_token) {
      throw new Error("Sign-in response did not include usable tokens.");
    }

    const claims = parseJwtPayload(tokens.id_token);
    const session: AuthSession = {
      accessToken: tokens.access_token,
      email: stringClaim(claims.email),
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      idToken: tokens.id_token,
      userId: stringClaim(claims.sub),
    };

    sessionStorage.setItem(tokenStorageKey, JSON.stringify(session));
    return session;
  } catch (error) {
    clearStoredSession();
    if (error instanceof TypeError) {
      throw new Error("Couldn't reach the sign-in service. Check your connection and try again.");
    }
    throw error;
  } finally {
    sessionStorage.removeItem(verifierStorageKey);
    sessionStorage.removeItem(stateStorageKey);
  }
}

export async function startSignIn() {
  await startHostedAuth("oauth2/authorize");
}

export async function startSignUp() {
  await startHostedAuth("signup");
}

async function startHostedAuth(path: "oauth2/authorize" | "signup") {
  if (!hasConfiguredAuth || !authDomain || !authClientId) {
    throw new Error("Authentication is not configured.");
  }
  if (!window.crypto?.subtle) {
    throw new Error("Secure sign-in needs HTTPS (or localhost). Open the site over HTTPS.");
  }

  // Start from a clean slate so an abandoned earlier attempt can't confuse this one.
  clearStoredSession();

  const verifier = randomBase64Url(32);
  const state = randomBase64Url(16);
  const challenge = await pkceChallenge(verifier);

  sessionStorage.setItem(verifierStorageKey, verifier);
  sessionStorage.setItem(stateStorageKey, state);

  const params = new URLSearchParams({
    client_id: authClientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: authRedirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  window.location.assign(`${authDomain}/${path}?${params.toString()}`);
}

export function signOut() {
  clearStoredSession();
  sessionStorage.removeItem(verifierStorageKey);
  sessionStorage.removeItem(stateStorageKey);

  if (!hasConfiguredAuth || !authDomain || !authClientId) {
    window.location.reload();
    return;
  }

  const params = new URLSearchParams({
    client_id: authClientId,
    logout_uri: authRedirectUri,
  });

  window.location.assign(`${authDomain}/logout?${params.toString()}`);
}

/** Drops the stored session, e.g. when the service reports it has expired. */
export function clearStoredSession() {
  sessionStorage.removeItem(tokenStorageKey);
}

function discardSignInAttempt() {
  sessionStorage.removeItem(verifierStorageKey);
  sessionStorage.removeItem(stateStorageKey);
  clearAuthQueryParams();
}

function clearAuthQueryParams() {
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function parseJwtPayload(token: string) {
  const payload = token.split(".")[1] ?? "";
  const base64 = payload
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}
