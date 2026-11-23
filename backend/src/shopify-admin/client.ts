import type { TokenCache } from "./token.js";

/** Thrown when a mutation returns non-empty userErrors (message text only). */
export class ShopifyUserErrors extends Error {
  readonly userErrors: { field?: string[] | null; message: string }[];

  constructor(userErrors: { field?: string[] | null; message: string }[]) {
    super(`Shopify Admin userErrors: ${userErrors.map((e) => e.message).join("; ").slice(0, 300)}`);
    this.name = "ShopifyUserErrors";
    this.userErrors = userErrors;
  }
}

type ThrottleStatus = {
  maximumAvailable?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
};

type GqlBody = {
  data?: unknown;
  errors?: { message: string }[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: ThrottleStatus } };
};

export type AdminClient = {
  request: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
};

export type CreateAdminClientOpts = {
  storeDomain: string;
  apiVersion: string;
  tokens: TokenCache;
  /** Override for tests. Default: https://{storeDomain} */
  origin?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Refresh the token bucket when currentlyAvailable is at or below this. */
  throttleFloor?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function collectUserErrors(data: unknown): { field?: string[] | null; message: string }[] {
  if (!data || typeof data !== "object") return [];
  const out: { field?: string[] | null; message: string }[] = [];
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const errs = (value as { userErrors?: unknown }).userErrors;
    if (!Array.isArray(errs)) continue;
    for (const e of errs) {
      if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
        out.push(e as { field?: string[] | null; message: string });
      }
    }
  }
  return out;
}

function throttleWaitMs(status: ThrottleStatus | undefined, floor: number): number {
  if (!status) return 0;
  const available = status.currentlyAvailable;
  const restoreRate = status.restoreRate;
  if (typeof available !== "number" || typeof restoreRate !== "number" || restoreRate <= 0) return 0;
  if (available > floor) return 0;
  const need = floor - available;
  return Math.max(0, Math.ceil(need / restoreRate) * 1000);
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 250 * 2 ** attempt);
}

/**
 * Typed GraphQL Admin API client: throttle-aware, retries 429/5xx, refreshes on 401,
 * surfaces userErrors. Never logs or embeds access tokens in errors.
 */
export function createAdminClient({
  storeDomain,
  apiVersion,
  tokens,
  origin,
  fetch: fetchFn = fetch,
  sleep = defaultSleep,
  timeoutMs = 20_000,
  maxRetries = 4,
  throttleFloor = 50,
}: CreateAdminClientOpts): AdminClient {
  const base = (origin ?? `https://${storeDomain}`).replace(/\/+$/, "");
  const url = `${base}/admin/api/${apiVersion}/graphql.json`;
  let pendingThrottleMs = 0;

  async function requestOnce(query: string, variables: Record<string, unknown>, token: string): Promise<{ status: number; body: GqlBody }> {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body: GqlBody = {};
    if (text) {
      try {
        body = JSON.parse(text) as GqlBody;
      } catch {
        throw new Error(`Shopify Admin API returned non-JSON (${response.status})`);
      }
    }
    return { status: response.status, body };
  }

  return {
    async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      let authRetried = false;

      for (let attempt = 0; ; attempt++) {
        if (pendingThrottleMs > 0) {
          const wait = pendingThrottleMs;
          pendingThrottleMs = 0;
          await sleep(wait);
        }

        const token = await tokens.getAccessToken();
        const { status, body } = await requestOnce(query, variables, token);

        const wait = throttleWaitMs(body.extensions?.cost?.throttleStatus, throttleFloor);
        if (wait > 0) pendingThrottleMs = Math.max(pendingThrottleMs, wait);

        if (status === 401 && !authRetried) {
          tokens.invalidate();
          authRetried = true;
          continue;
        }

        if (status === 429 || status >= 500) {
          if (attempt >= maxRetries) throw new Error(`Shopify Admin API returned ${status}`);
          await sleep(backoffMs(attempt));
          continue;
        }

        if (status < 200 || status >= 300) {
          throw new Error(`Shopify Admin API returned ${status}`);
        }

        if (body.errors?.length) {
          throw new Error(`Shopify Admin API: ${body.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
        }
        if (body.data === undefined || body.data === null) {
          throw new Error("Shopify Admin API returned no data");
        }

        const userErrors = collectUserErrors(body.data);
        if (userErrors.length) throw new ShopifyUserErrors(userErrors);

        return body.data as T;
      }
    },
  };
}
