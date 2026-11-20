import type { FastifyInstance } from "fastify";
import type { WebhookIntake } from "../db/webhooks.js";
import { verifyShopifyHmac } from "../shopify-hmac.js";
import { CATALOG_TOPICS } from "../webhooks/topics.js";

export type WebhookRouteDeps = {
  /** SHOPIFY_WEBHOOK_SECRET; when missing, webhooks get 500 so Shopify retries later. */
  secret?: string;
  intake: WebhookIntake;
};

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/**
 * Public endpoint for Shopify webhooks (no service token: the HMAC is the auth).
 * Records the event, drops duplicates by webhook ID, queues catalog topics, and
 * answers 200 straight away; processing happens in the queue.
 */
export async function webhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps) {
  // In this plugin only: keep JSON bodies as raw bytes, because the signature covers the exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/webhooks/shopify", async (request, reply) => {
    if (!deps.secret) {
      request.log.error("SHOPIFY_WEBHOOK_SECRET is not set");
      return reply.code(500).send({ error: "not_configured" });
    }

    const raw = Buffer.isBuffer(request.body) ? request.body : null;
    if (!raw || !verifyShopifyHmac(raw, header(request.headers["x-shopify-hmac-sha256"]), deps.secret)) {
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

    const handled = CATALOG_TOPICS.has(topic);
    const { duplicate } = await deps.intake({
      webhookId,
      topic,
      shopDomain: header(request.headers["x-shopify-shop-domain"]) ?? "",
      payload: handled ? payload : null,
      handled,
    });
    request.log.info({ topic, duplicate, handled }, "shopify webhook");
    return duplicate ? { ok: true, duplicate: true } : { ok: true };
  });
}
