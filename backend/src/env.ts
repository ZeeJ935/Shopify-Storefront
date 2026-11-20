export type Env = {
  host: string;
  port: number;
  databaseUrl: string;
  serviceToken: string;
  /** Shopify webhook signing secret. Optional at start; webhooks get 500 until it's set. */
  shopifyWebhookSecret?: string;
  /** Storefront origin for cache clearing (POST /api/revalidate). */
  storefrontUrl?: string;
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

  return {
    host: source.HOST?.trim() || "127.0.0.1",
    port,
    databaseUrl,
    serviceToken,
    shopifyWebhookSecret: source.SHOPIFY_WEBHOOK_SECRET?.trim() || undefined,
    storefrontUrl,
  };
}
