// Pure session rules (no next/* imports) so they can be unit tested.
export const SESSION_COOKIE = "zj-admin-session";
export const OAUTH_COOKIE = "zj-admin-oauth";
/** Refresh the staff token when it has less than this left. */
export const REFRESH_BEFORE_SECONDS = 120;
/** How long a sign-in attempt (state/nonce/verifier) stays valid. */
export const OAUTH_COOKIE_MAX_AGE = 10 * 60;

export type StaffRole = "viewer" | "operator" | "admin";
export type StaffIdentity = { id: number; email: string; role: StaffRole };

/** What the sealed session cookie holds: the backend-issued staff token and its times (unix seconds). */
export type AdminSession = {
  token: string;
  tokenExpiresAt: number;
  /** Hard limit from the backend (Google sign-in + 8 h). Never extended. */
  sessionExpiresAt: number;
  staff: StaffIdentity;
};

/** The short-lived sign-in attempt cookie. */
export type OAuthAttempt = { state: string; nonce: string; verifier: string; createdAt: number };

const ROLES = new Set(["viewer", "operator", "admin"]);

export function parseSession(raw: unknown): AdminSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const staff = s.staff as Record<string, unknown> | undefined;
  if (
    typeof s.token !== "string" ||
    !s.token ||
    typeof s.tokenExpiresAt !== "number" ||
    typeof s.sessionExpiresAt !== "number" ||
    !staff ||
    typeof staff.id !== "number" ||
    typeof staff.email !== "string" ||
    !ROLES.has(staff.role as string)
  ) {
    return null;
  }
  return {
    token: s.token,
    tokenExpiresAt: s.tokenExpiresAt,
    sessionExpiresAt: s.sessionExpiresAt,
    staff: { id: staff.id, email: staff.email, role: staff.role as StaffRole },
  };
}

export function parseOAuthAttempt(raw: unknown, nowSeconds: number): OAuthAttempt | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.state !== "string" || typeof a.nonce !== "string" || typeof a.verifier !== "string" || typeof a.createdAt !== "number") {
    return null;
  }
  if (nowSeconds - a.createdAt > OAUTH_COOKIE_MAX_AGE) return null;
  return { state: a.state, nonce: a.nonce, verifier: a.verifier, createdAt: a.createdAt };
}

/**
 * What the proxy should do with a request's session:
 * - "login": no/invalid session, or past the 8-hour hard limit → sign in with Google again.
 * - "refresh": token expires within REFRESH_BEFORE_SECONDS (or has expired) → ask the backend.
 * - "ok": use it as is.
 */
export function sessionAction(session: AdminSession | null, nowSeconds: number): "login" | "refresh" | "ok" {
  if (!session) return "login";
  if (nowSeconds >= session.sessionExpiresAt) return "login";
  if (session.tokenExpiresAt - nowSeconds < REFRESH_BEFORE_SECONDS) return "refresh";
  return "ok";
}

export function sessionCookieOptions(session: AdminSession, nowSeconds: number, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    // The cookie never outlives the backend's hard session limit.
    maxAge: Math.max(0, session.sessionExpiresAt - nowSeconds),
  };
}

export const roleRank = (role: StaffRole) => ["viewer", "operator", "admin"].indexOf(role);
export const hasRole = (staff: StaffIdentity, required: StaffRole) => roleRank(staff.role) >= roleRank(required);
