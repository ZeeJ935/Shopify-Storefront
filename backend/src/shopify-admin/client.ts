import type { TokenCache } from "./token.js";

export type AdminUserError = { field?: string[] | null; message: string; code?: string | null };

/** Thrown when a mutation returns non-empty userErrors. `codes` holds each error's `code` when selected. */
export class ShopifyUserErrors extends Error {
  readonly userErrors: AdminUserError[];
  readonly codes: string[];

  constructor(userErrors: AdminUserError[]) {
    super(`Shopify Admin userErrors: ${userErrors.map((e) => e.message).join("; ").slice(0, 300)}`);
    this.name = "ShopifyUserErrors";
    this.userErrors = userErrors;
    this.codes = [...new Set(userErrors.map((e) => e.code).filter((c): c is string => typeof c === "string"))];
  }
}

/**
 * Thrown for GraphQL top-level errors that are not retried (e.g. ACCESS_DENIED).
 * `codes` are the errors[].extensions.code values so callers can match on codes
 * instead of message text. Message is capped; never contains tokens.
 */
export class ShopifyGraphqlError extends Error {
  readonly codes: string[];

  constructor(errors: GqlError[]) {
    super(`Shopify Admin API: ${errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    this.name = "ShopifyGraphqlError";
    this.codes = [...new Set(errors.map((e) => e.extensions?.code).filter((c): c is string => typeof c === "string"))];
  }
}

type GqlError = { message: string; extensions?: { code?: string } };

type ThrottleStatus = {
  maximumAvailable?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
};

type QueryCost = { requestedQueryCost?: number; throttleStatus?: ThrottleStatus };

type GqlBody = {
  data?: unknown;
  errors?: GqlError[];
  extensions?: { cost?: QueryCost };
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

function collectUserErrors(data: unknown): AdminUserError[] {
  if (!data || typeof data !== "object") return [];
  const out: AdminUserError[] = [];
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const errs = (value as { userErrors?: unknown }).userErrors;
    if (!Array.isArray(errs)) continue;
    for (const e of errs) {
      if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
        out.push(e as AdminUserError);
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

/** Wait before retrying a THROTTLED query: time to restore enough points for it. */
function throttledRetryMs(cost: QueryCost | undefined, attempt: number): number {
  const requested = cost?.requestedQueryCost;
  const available = cost?.throttleStatus?.currentlyAvailable;
  const restoreRate = cost?.throttleStatus?.restoreRate;
  if (typeof requested === "number" && typeof available === "number" && typeof restoreRate === "number" && restoreRate > 0) {
    const need = Math.max(0, requested - available);
    return Math.max(1000, Math.ceil(need / restoreRate) * 1000);
  }
  return backoffMs(attempt);
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 250 * 2 ** attempt);
}

/**
 * Typed GraphQL Admin API client: throttle-aware, retries THROTTLED / 429 / 5xx /
 * network errors and timeouts, refreshes on 401, surfaces userErrors and GraphQL
 * error codes (ShopifyGraphqlError). Never logs or embeds access tokens in errors.
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
        // A 429/5xx gateway page is often HTML: let the status decide (retried below).
        if (response.status === 429 || response.status >= 500) return { status: response.status, body: {} };
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
        let result: { status: number; body: GqlBody };
        try {
          result = await requestOnce(query, variables, token);
        } catch (error) {
          // fetch rejected (network error or AbortSignal timeout). Non-JSON 2xx/4xx is not retried.
          const message = error instanceof Error ? error.message : "";
          if (message.startsWith("Shopify Admin API returned non-JSON")) throw error;
          if (attempt >= maxRetries) {
            const name = error instanceof Error ? error.name : "Error";
            throw new Error(`Shopify Admin API request failed (${name})`);
          }
          await sleep(backoffMs(attempt));
          continue;
        }
        const { status, body } = result;

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
          if (body.errors.some((e) => e.extensions?.code === "THROTTLED")) {
            if (attempt >= maxRetries) throw new ShopifyGraphqlError(body.errors);
            // The bucket wait already queued above is not needed on top of this one.
            pendingThrottleMs = 0;
            await sleep(throttledRetryMs(body.extensions?.cost, attempt));
            continue;
          }
          throw new ShopifyGraphqlError(body.errors);
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
