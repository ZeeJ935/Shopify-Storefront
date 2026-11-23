import { createAdminClient, type AdminClient } from "./client.js";
import { createAdminHealthCheck, type AdminApiHealth, type AdminHealthChecker } from "./health.js";
import { createTokenCache, type CreateTokenCacheOpts } from "./token.js";

export { ShopifyGraphqlError, ShopifyUserErrors } from "./client.js";
export type { AdminApiHealth, AdminClient, AdminHealthChecker };

/** Pinned Admin GraphQL API version used when SHOPIFY_ADMIN_API_VERSION is unset. */
export const DEFAULT_ADMIN_API_VERSION = "2026-10";

export type ShopifyAdmin = AdminClient & {
  checkHealth: () => Promise<AdminApiHealth>;
};

export type CreateShopifyAdminOpts = {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
  origin?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

/** Builds the Admin token cache + GraphQL client + cached health probe. */
export function createShopifyAdmin(opts: CreateShopifyAdminOpts): ShopifyAdmin {
  const apiVersion = opts.apiVersion ?? DEFAULT_ADMIN_API_VERSION;
  const tokenOpts: CreateTokenCacheOpts = {
    storeDomain: opts.storeDomain,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    origin: opts.origin,
    fetch: opts.fetch,
    now: opts.now,
  };
  const tokens = createTokenCache(tokenOpts);
  const client = createAdminClient({
    storeDomain: opts.storeDomain,
    apiVersion,
    tokens,
    origin: opts.origin,
    fetch: opts.fetch,
    sleep: opts.sleep,
    timeoutMs: opts.timeoutMs,
  });
  const health: AdminHealthChecker = createAdminHealthCheck(client, { now: opts.now });
  return {
    request: client.request,
    checkHealth: health.check,
  };
}
