/** Default lead time before expiry when we refresh the cached token. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export type TokenCache = {
  getAccessToken: () => Promise<string>;
  /** Drop the cached token so the next call fetches a fresh one (e.g. after 401). */
  invalidate: () => void;
};

export type CreateTokenCacheOpts = {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  /** Override for tests (e.g. http://127.0.0.1:port). Default: https://{storeDomain} */
  origin?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};

/**
 * Client-credentials access tokens for a Dev Dashboard app.
 * Lifetime comes from the response `expires_in`; never hard-coded.
 * Tokens and the client secret never appear in thrown messages.
 */
export function createTokenCache({
  storeDomain,
  clientId,
  clientSecret,
  origin,
  fetch: fetchFn = fetch,
  now = Date.now,
}: CreateTokenCacheOpts): TokenCache {
  const base = (origin ?? `https://${storeDomain}`).replace(/\/+$/, "");
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const response = await fetchFn(`${base}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Shopify Admin token request failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof json.access_token !== "string" || !json.access_token) {
      throw new Error("Shopify Admin token response missing access_token");
    }
    if (typeof json.expires_in !== "number" || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
      throw new Error("Shopify Admin token response missing expires_in");
    }

    cached = {
      token: json.access_token,
      expiresAt: now() + json.expires_in * 1000,
    };
    return cached.token;
  }

  return {
    invalidate() {
      cached = null;
    },
    async getAccessToken() {
      if (cached && now() < cached.expiresAt - TOKEN_REFRESH_SKEW_MS) return cached.token;
      if (!inflight) {
        inflight = fetchToken().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
