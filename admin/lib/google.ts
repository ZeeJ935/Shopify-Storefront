// Google OAuth 2.0 / OpenID Connect (authorization code + PKCE, state, nonce). Server only.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const random = (bytes: number) => randomBytes(bytes).toString("base64url");

export function createAttempt(nowSeconds: number) {
  return { state: random(24), nonce: random(24), verifier: random(48), createdAt: nowSeconds };
}

export const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Constant-time comparison for state values. */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

export const redirectUri = (appUrl: string) => `${appUrl}/auth/callback`;

/** Only the client id goes in the URL — never the secret. */
export function authorizationUrl(opts: { clientId: string; appUrl: string; state: string; nonce: string; verifier: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: redirectUri(opts.appUrl),
    response_type: "code",
    scope: "openid email",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: codeChallenge(opts.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
    access_type: "online",
  }).toString();
  return url.toString();
}

/** Exchanges the code for tokens and returns the ID token (verified later by the backend). */
export async function exchangeCode(
  opts: { clientId: string; clientSecret: string; appUrl: string; code: string; verifier: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: redirectUri(opts.appUrl),
      code_verifier: opts.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const json = (await response.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string" || !json.id_token) throw new Error("Google token response had no id_token");
  return json.id_token;
}
