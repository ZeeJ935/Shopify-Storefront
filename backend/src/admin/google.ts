import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

export type GoogleIdentity = { sub: string; email: string; hostedDomain: string | null };

/** Verifies a Google ID token; throws GoogleTokenError with an internal reason (never shown to callers). */
export type GoogleVerifier = (idToken: string, expectedNonce: string) => Promise<GoogleIdentity>;

export class GoogleTokenError extends Error {
  constructor(readonly reason: string) {
    super(`google id token rejected: ${reason}`);
    this.name = "GoogleTokenError";
  }
}

/**
 * Google ID token verification: RS256 signature against Google's published keys
 * (cached by jose), issuer, audience = our OAuth client id, expiry, nonce,
 * email_verified, and the Workspace domain (`hd`) when configured.
 */
export function createGoogleVerifier(opts: {
  clientId: string;
  hostedDomain?: string;
  /** Tests pass a local key set. */
  keySet?: JWTVerifyGetKey;
  now?: () => number;
}): GoogleVerifier {
  const keySet = opts.keySet ?? createRemoteJWKSet(GOOGLE_JWKS_URL);
  return async (idToken, expectedNonce) => {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, keySet, {
        algorithms: ["RS256"],
        issuer: GOOGLE_ISSUERS,
        audience: opts.clientId,
        clockTolerance: 30,
        currentDate: opts.now ? new Date(opts.now()) : undefined,
        requiredClaims: ["sub", "exp", "iat"],
      }));
    } catch {
      throw new GoogleTokenError("invalid_token");
    }
    if (typeof payload.nonce !== "string" || !expectedNonce || payload.nonce !== expectedNonce) throw new GoogleTokenError("nonce");
    if (payload.email_verified !== true) throw new GoogleTokenError("email_unverified");
    if (typeof payload.email !== "string" || typeof payload.sub !== "string") throw new GoogleTokenError("claims");
    const hd = typeof payload.hd === "string" ? payload.hd.toLowerCase() : null;
    if (opts.hostedDomain && hd !== opts.hostedDomain) throw new GoogleTokenError("hosted_domain");
    return { sub: payload.sub, email: payload.email.toLowerCase(), hostedDomain: hd };
  };
}
