import type { FastifyInstance } from "fastify";
import type { WebhookIntake } from "../db/webhooks.js";
import { verifyShopifyHmac } from "../shopify-hmac.js";
import { payloadForStorage } from "../webhooks/payload.js";
import type { TopicRouter } from "../webhooks/router.js";

export type WebhookRouteDeps = {
  /**
   * Signing secrets: Shopify-admin webhooks use SHOPIFY_WEBHOOK_SECRET;
   * app-created subscriptions use SHOPIFY_ADMIN_CLIENT_SECRET. Accept either.
   * When empty, webhooks get 500 so Shopify retries later.
   */
  secrets: string[];
  intake: WebhookIntake;
  /** Used to decide which topics are queued vs recorded-only. */
  router: TopicRouter;
};

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** True when the HMAC matches any configured secret (each check is constant-time). */
export function verifyAnyShopifyHmac(rawBody: Buffer, hmacHeader: string | undefined, secrets: string[]): boolean {
  if (!hmacHeader || secrets.length === 0) return false;
  let matched = false;
  for (const secret of secrets) {
    if (verifyShopifyHmac(rawBody, hmacHeader, secret)) matched = true;
  }
  return matched;
}

/**
 * Public endpoint for Shopify webhooks (no service token: the HMAC is the auth).
 * Records the event, drops duplicates by webhook ID, queues handled topics, and
 * answers 200 straight away; processing happens in the queue.
 */
export async function webhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps) {
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/webhooks/shopify", async (request, reply) => {
    if (deps.secrets.length === 0) {
      request.log.error("no Shopify webhook signing secrets configured");
      return reply.code(500).send({ error: "not_configured" });
    }

    const raw = Buffer.isBuffer(request.body) ? request.body : null;
    if (!raw || !verifyAnyShopifyHmac(raw, header(request.headers["x-shopify-hmac-sha256"]), deps.secrets)) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const webhookId = header(request.headers["x-shopify-webhook-id"]);
    const topic = header(request.headers["x-shopify-topic"]);
    if (!webhookId || !topic) return reply.code(400).send({ error: "missing_webhook_headers" });

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.code(400).send({ error: "invalid_json" });
    }

    const handled = deps.router.isHandled(topic);
    const triggeredAt = header(request.headers["x-shopify-triggered-at"]) ?? null;
    const apiVersion = header(request.headers["x-shopify-api-version"]) ?? null;

    const { duplicate } = await deps.intake({
      webhookId,
      topic,
      shopDomain: header(request.headers["x-shopify-shop-domain"]) ?? "",
      payload: payloadForStorage(topic, payload, handled),
      handled,
      triggeredAt,
      apiVersion,
    });
    request.log.info({ topic, duplicate, handled }, "shopify webhook");
    return duplicate ? { ok: true, duplicate: true } : { ok: true };
  });
}
