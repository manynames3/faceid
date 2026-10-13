import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionKey = "face-sorter-auth-session";
let values: Map<string, string>;
let location: { origin: string; pathname: string; search: string };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_AUTH_DOMAIN", "https://auth.example.test");
  vi.stubEnv("VITE_AUTH_CLIENT_ID", "test-client");
  values = new Map();
  location = {origin: "http://localhost", pathname: "/", search: ""};
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", {
    location,
    history: {replaceState: vi.fn(() => {location.search = "";})},
  });
  vi.stubGlobal("document", {title: "Test"});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Cognito callback", () => {
  it("exchanges a one-use code once when StrictMode starts completion twice", async () => {
    location.search = "?code=test-code&state=test-state";
    values.set("face-sorter-pkce-verifier", "test-verifier");
    values.set("face-sorter-oauth-state", "test-state");
    const idToken = `header.${btoa(JSON.stringify({sub: "test-user", email: "test@example.test"}))}.signature`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id_token: idToken, access_token: "test-access-token", expires_in: 60,
    })));
    vi.stubGlobal("fetch", fetchMock);
    const {completeSignInFromUrl} = await import("./auth");

    const first = completeSignInFromUrl();
    const second = completeSignInFromUrl();
    expect(first).toBe(second);
    const [a, b] = await Promise.all([first, second]);
    expect(a?.userId).toBe("test-user");
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://auth.example.test/oauth2/token");
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("test-verifier");
    expect(values.has("face-sorter-pkce-verifier")).toBe(false);
    expect(values.has("face-sorter-oauth-state")).toBe(false);
    expect(location.search).toBe("");
  });

  it("rejects a callback with the wrong OAuth state before sending credentials", async () => {
    location.search = "?code=test-code&state=wrong-state";
    values.set("face-sorter-pkce-verifier", "test-verifier");
    values.set("face-sorter-oauth-state", "test-state");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const {completeSignInFromUrl} = await import("./auth");
    await expect(completeSignInFromUrl()).rejects.toThrow("Start sign-in again");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(values.has("face-sorter-pkce-verifier")).toBe(false);
  });

  it("clears failed attempts and permits a fresh sign-in after a token error", async () => {
    location.search = "?code=test-code&state=test-state";
    values.set("face-sorter-pkce-verifier", "test-verifier");
    values.set("face-sorter-oauth-state", "test-state");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 400})));
    const {completeSignInFromUrl} = await import("./auth");
    await expect(completeSignInFromUrl()).rejects.toThrow("Start sign-in again");
    expect(values.has(sessionKey)).toBe(false);
    expect(values.has("face-sorter-oauth-state")).toBe(false);
    expect(location.search).toBe("");
  });
});

describe("stored sessions", () => {
  it("rejects expired or malformed expiry metadata", async () => {
    const {getStoredSession} = await import("./auth");
    for (const expiresAt of [Date.now() - 1, undefined, "later", null]) {
      values.set(sessionKey, JSON.stringify({idToken: "test-id-token", accessToken: "test-access-token", expiresAt}));
      expect(getStoredSession()).toBeNull();
      expect(values.has(sessionKey)).toBe(false);
    }
  });
});
