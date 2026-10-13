export type ApiErrorKind =
  | "session_expired"
  | "rate_limited"
  | "validation"
  | "forbidden"
  | "not_found"
  | "server"
  | "network"
  | "unknown";

/** Which step of a request failed; uploads are presign -> S3 PUT -> process. */
export type ApiStage = "request" | "presign" | "upload" | "process";

type ApiErrorInit = {
  kind: ApiErrorKind;
  message: string;
  stage?: ApiStage;
  status: number;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly stage: ApiStage;
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;

  constructor({ kind, message, stage = "request", status }: ApiErrorInit) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.stage = stage;
    this.status = status;
  }

  /**
   * True when the server may have finished the work even though we saw an
   * error (timeout, dropped connection, 5xx while processing). Callers should
   * refresh before retrying so a saved item is not duplicated.
   */
  get uncertain() {
    return this.stage === "process" && (this.kind === "network" || this.kind === "server");
  }
}

const maxServerMessageLength = 240;

/** Keeps a server-supplied message only if it is short, printable text. */
export function sanitizeServerMessage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > maxServerMessageLength
    ? `${cleaned.slice(0, maxServerMessageLength - 1)}…`
    : cleaned;
}

export function apiErrorFromStatus(
  status: number,
  serverMessage?: unknown,
  stage: ApiStage = "request",
): ApiError {
  const detail = sanitizeServerMessage(serverMessage);

  if (status === 401) {
    return new ApiError({
      kind: "session_expired",
      message: "Your session has expired. Sign in again to continue.",
      stage,
      status,
    });
  }
  if (status === 403) {
    return new ApiError({
      kind: "forbidden",
      message: "This account doesn't have access to that. Check you're signed in to the right account.",
      stage,
      status,
    });
  }
  if (status === 404) {
    return new ApiError({
      kind: "not_found",
      message: "That item wasn't found. It may have been deleted; refresh and try again.",
      stage,
      status,
    });
  }
  if (status === 429) {
    return new ApiError({
      kind: "rate_limited",
      message: "Too many requests right now. Wait a few seconds, then try again.",
      stage,
      status,
    });
  }
  if (status >= 500) {
    return new ApiError({
      kind: "server",
      message:
        stage === "process"
          ? "Processing didn't finish cleanly, so this may still have been saved. Refresh before trying again."
          : "The service had a problem. Wait a moment, then try again.",
      stage,
      status,
    });
  }
  if (status === 400 || status === 413 || status === 422) {
    return new ApiError({
      kind: "validation",
      message: detail ?? "The request wasn't accepted. Check the details and try again.",
      stage,
      status,
    });
  }
  if (status === 409) {
    return new ApiError({ kind: "unknown", message: detail ?? "This request is still running. Check its result before trying again.", stage, status });
  }
  return new ApiError({
    kind: "unknown",
    message: `The request wasn't accepted (status ${status}).`,
    stage,
    status,
  });
}

export function networkError(stage: ApiStage = "request"): ApiError {
  return new ApiError({
    kind: "network",
    message:
      stage === "process"
        ? "The connection dropped while processing, so this may still have been saved. Refresh before trying again."
        : "Can't reach the service. Check your connection and try again.",
    stage,
    status: 0,
  });
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isSessionExpired(error: unknown) {
  return error instanceof ApiError && error.kind === "session_expired";
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
