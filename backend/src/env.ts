import { readAdminEnv, type AdminEnv } from "./admin/env.js";
import { DEFAULT_ADMIN_API_VERSION } from "./shopify-admin/index.js";

export type Env = {
  host: string;
  port: number;
  databaseUrl: string;
  serviceToken: string;
  /** Shopify webhook signing secret. Optional at start; webhooks get 500 until it's set. */
  shopifyWebhookSecret?: string;
  /** Storefront origin for cache clearing (POST /api/revalidate). */
  storefrontUrl?: string;
  /** Storefront API access for catalog sync; both optional (sync is off without them). */
  shopifyStoreDomain?: string;
  shopifyStorefrontToken?: string;
  /** Admin API (Dev Dashboard client credentials). Optional; Admin features stay off without them. */
  shopifyAdminClientId?: string;
  shopifyAdminClientSecret?: string;
  /** Pinned Admin GraphQL version (default 2026-10). */
  shopifyAdminApiVersion: string;
  /** Public backend origin for app webhook subscriptions (no trailing slash). Optional at API start. */
  backendPublicUrl?: string;
  /** GET /v1/debug/sentry (throws on purpose). Only when SENTRY_DEBUG=1. */
  debugRoutes: boolean;
  /** Staff admin (/admin/*). Undefined = off. */
  staffAdmin?: AdminEnv;
};

/** Reads and validates the service's environment. Throws with a clear message when something is missing. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source.DATABASE_URL?.trim();
  const serviceToken = source.BACKEND_SERVICE_TOKEN?.trim();
  const port = Number(source.PORT ?? 4000);

  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!serviceToken || serviceToken.length < 32) {
    throw new Error("BACKEND_SERVICE_TOKEN is required and must be at least 32 characters.");
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid port number.");
  }

  const storefrontUrl = source.STOREFRONT_URL?.trim().replace(/\/+$/, "") || undefined;
  if (storefrontUrl && !/^https?:\/\//.test(storefrontUrl)) {
    throw new Error("STOREFRONT_URL must start with http:// or https://.");
  }

  const adminVersionRaw = source.SHOPIFY_ADMIN_API_VERSION?.trim();
  const shopifyAdminApiVersion = adminVersionRaw || DEFAULT_ADMIN_API_VERSION;
  if (!/^\d{4}-\d{2}$/.test(shopifyAdminApiVersion)) {
    throw new Error("SHOPIFY_ADMIN_API_VERSION must look like YYYY-MM (e.g. 2026-10).");
  }

  const backendPublicUrl = source.BACKEND_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined;
  if (backendPublicUrl && !/^https?:\/\//.test(backendPublicUrl)) {
    throw new Error("BACKEND_PUBLIC_URL must start with http:// or https://.");
  }

  return {
    host: source.HOST?.trim() || "127.0.0.1",
    port,
    databaseUrl,
    serviceToken,
    shopifyWebhookSecret: source.SHOPIFY_WEBHOOK_SECRET?.trim() || undefined,
    storefrontUrl,
    shopifyStoreDomain: source.SHOPIFY_STORE_DOMAIN?.trim() || undefined,
    shopifyStorefrontToken: source.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim() || undefined,
    shopifyAdminClientId: source.SHOPIFY_ADMIN_CLIENT_ID?.trim() || undefined,
    shopifyAdminClientSecret: source.SHOPIFY_ADMIN_CLIENT_SECRET?.trim() || undefined,
    shopifyAdminApiVersion,
    backendPublicUrl,
    debugRoutes: source.SENTRY_DEBUG?.trim() === "1",
    staffAdmin: readAdminEnv(source),
  };
}
