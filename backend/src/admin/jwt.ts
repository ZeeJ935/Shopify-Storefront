import { createHash } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { isStaffRole, type StaffRole } from "./allowlist.js";

export const STAFF_JWT_ISSUER = "zj-backend";
export const STAFF_JWT_AUDIENCE = "zj-admin";
/** A staff token is valid this long (and never past the session limit). */
export const STAFF_TOKEN_TTL_SECONDS = 15 * 60;
/** Hard limit: no token is ever valid past this long after the Google sign-in. */
export const STAFF_SESSION_MAX_SECONDS = 8 * 60 * 60;
export const CLOCK_TOLERANCE_SECONDS = 30;

export type StaffClaims = {
  staffId: number;
  email: string;
  role: StaffRole;
  /** Unix seconds of the original Google sign-in (claim `sst`). */
  sessionStartedAt: number;
  expiresAt: number;
};

export type StaffKeys = { current: string; previous?: string };

export class StaffTokenError extends Error {
  constructor(readonly reason: string) {
    super(`invalid staff token: ${reason}`);
    this.name = "StaffTokenError";
  }
}

/** Key id derived from the secret (not reversible), so rotation needs no extra config. */
export function keyId(secret: string): string {
  return createHash("sha256").update(`zj-staff-jwt:${secret}`).digest("hex").slice(0, 16);
}

const keyBytes = (secret: string) => new TextEncoder().encode(secret);
const nowSeconds = (now: number) => Math.floor(now / 1000);

/**
 * Signs a staff token with the current key. Expiry is min(now + 15 min, session
 * start + 8 h): refreshing can never extend a session past 8 hours.
 */
export async function signStaffToken(
  keys: StaffKeys,
  claims: { staffId: number; email: string; role: StaffRole; sessionStartedAt: number },
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const iat = nowSeconds(now);
  const exp = Math.min(iat + STAFF_TOKEN_TTL_SECONDS, claims.sessionStartedAt + STAFF_SESSION_MAX_SECONDS);
  if (exp <= iat) throw new StaffTokenError("session_expired");
  const token = await new SignJWT({ email: claims.email, role: claims.role, sst: claims.sessionStartedAt })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: keyId(keys.current) })
    .setIssuer(STAFF_JWT_ISSUER)
    .setAudience(STAFF_JWT_AUDIENCE)
    .setSubject(String(claims.staffId))
    .setJti(crypto.randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(keyBytes(keys.current));
  return { token, expiresAt: exp };
}

function claimsFrom(payload: JWTPayload): StaffClaims {
  const staffId = Number(payload.sub);
  const { email, role, sst, exp } = payload as JWTPayload & { email?: unknown; role?: unknown; sst?: unknown };
  if (!Number.isSafeInteger(staffId) || staffId <= 0) throw new StaffTokenError("bad_subject");
  if (typeof email !== "string" || !email) throw new StaffTokenError("bad_email");
  if (!isStaffRole(role)) throw new StaffTokenError("bad_role");
  if (typeof sst !== "number" || typeof exp !== "number") throw new StaffTokenError("bad_times");
  return { staffId, email, role, sessionStartedAt: sst, expiresAt: exp };
}

/**
 * Verifies a staff token: HS256 only (no `none`, no RS/ES confusion), issuer, audience,
 * expiry (30 s tolerance), and a key id matching the current or previous key.
 * `allowExpired` (refresh only) still checks the signature but tolerates an expired
 * token; the 8-hour session limit is always enforced.
 */
export async function verifyStaffToken(
  keys: StaffKeys,
  token: string,
  opts: { allowExpired?: boolean; now?: number } = {},
): Promise<StaffClaims> {
  const now = opts.now ?? Date.now();
  let kid: string | undefined;
  let exp: number | undefined;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "HS256") throw new StaffTokenError("bad_alg");
    kid = header.kid;
    exp = decodeJwt(token).exp;
  } catch (error) {
    if (error instanceof StaffTokenError) throw error;
    throw new StaffTokenError("malformed");
  }
  const secret = [keys.current, keys.previous].find((s): s is string => Boolean(s) && keyId(s!) === kid);
  if (!secret) throw new StaffTokenError("unknown_key");

  // For refresh, verify "as of" the token's own expiry so an expired-but-genuine token passes.
  const verifyAt = opts.allowExpired && typeof exp === "number" ? Math.min(now, (exp - 1) * 1000) : now;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keyBytes(secret), {
      algorithms: ["HS256"],
      issuer: STAFF_JWT_ISSUER,
      audience: STAFF_JWT_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: new Date(verifyAt),
      requiredClaims: ["sub", "exp", "iat", "sst"],
    }));
  } catch {
    throw new StaffTokenError("invalid");
  }
  const claims = claimsFrom(payload);
  if (nowSeconds(now) >= claims.sessionStartedAt + STAFF_SESSION_MAX_SECONDS) throw new StaffTokenError("session_expired");
  return claims;
}
