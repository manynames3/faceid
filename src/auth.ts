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
    if (!session.idToken || !session.accessToken || session.expiresAt <= Date.now()) {
      clearStoredSession();
      return null;
    }

    return session;
  } catch {
    clearStoredSession();
    return null;
  }
}

export async function completeSignInFromUrl(): Promise<AuthSession | null> {
  if (!hasConfiguredAuth || !authDomain || !authClientId) {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error_description") ?? params.get("error");
  const code = params.get("code");

  if (authError) {
    clearAuthQueryParams();
    throw new Error(`Sign-in failed: ${authError}`);
  }

  if (!code) {
    return getStoredSession();
  }

  const verifier = sessionStorage.getItem(verifierStorageKey);
  const expectedState = sessionStorage.getItem(stateStorageKey);
  const actualState = params.get("state");

  if (!verifier || !expectedState || expectedState !== actualState) {
    clearAuthQueryParams();
    throw new Error("Sign-in response could not be verified.");
  }

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
    clearAuthQueryParams();
    throw new Error(`Sign-in token exchange failed with status ${tokenResponse.status}`);
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;
  if (!tokens.id_token || !tokens.access_token) {
    clearAuthQueryParams();
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
  sessionStorage.removeItem(verifierStorageKey);
  sessionStorage.removeItem(stateStorageKey);
  clearAuthQueryParams();

  return session;
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

function clearStoredSession() {
  sessionStorage.removeItem(tokenStorageKey);
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
