import type { FastifyInstance } from "fastify";
import type pg from "pg";
import {
  createFulfillmentAction,
  getFulfillmentAction,
  type EnqueueActionOnClient,
  type FulfillmentRequest,
} from "../fulfillments/actions.js";

export type FulfillmentRouteDeps = {
  pool: pg.Pool;
  /** Absent when Admin isn't configured: only dry runs are accepted then. */
  enqueueOnClient?: EnqueueActionOnClient;
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

const body = {
  type: "object",
  additionalProperties: false,
  required: ["fulfillment_order_id"],
  properties: {
    fulfillment_order_id: { type: "string", minLength: 1, maxLength: 100 },
    lines: {
      type: "array",
      minItems: 1,
      maxItems: 512,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "quantity"],
        properties: { id: { type: "string", minLength: 1, maxLength: 100 }, quantity: { type: "integer", minimum: 1 } },
      },
    },
    tracking: {
      type: "object",
      additionalProperties: false,
      properties: {
        company: { type: "string", minLength: 1, maxLength: 100 },
        number: { type: "string", minLength: 1, maxLength: 100 },
        url: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
    notify_customer: { type: "boolean" },
    dry_run: { type: "boolean" },
  },
} as const;

type Body = {
  fulfillment_order_id: string;
  lines?: { id: string; quantity: number }[];
  tracking?: { company?: string; number?: string; url?: string };
  notify_customer?: boolean;
  dry_run?: boolean;
};

function gid(resource: "FulfillmentOrder" | "FulfillmentOrderLineItem", id: string): string | null {
  if (/^\d+$/.test(id)) return `gid://shopify/${resource}/${id}`;
  return new RegExp(`^gid://shopify/${resource}/\\d+$`).test(id) ? id : null;
}

/** Validates and normalizes the body; returns an error code for 400 responses. */
export function normalizeRequest(b: Body): { request: FulfillmentRequest } | { error: string } {
  const fulfillmentOrderId = gid("FulfillmentOrder", b.fulfillment_order_id);
  if (!fulfillmentOrderId) return { error: "invalid_fulfillment_order_id" };

  let lines: FulfillmentRequest["lines"] = null;
  if (b.lines) {
    const seen = new Set<string>();
    lines = [];
    for (const line of b.lines) {
      const id = gid("FulfillmentOrderLineItem", line.id);
      if (!id) return { error: "invalid_line_id" };
      if (seen.has(id)) return { error: "duplicate_line_id" };
      seen.add(id);
      lines.push({ id, quantity: line.quantity });
    }
    lines.sort((a, z) => a.id.localeCompare(z.id));
  }

  let tracking: FulfillmentRequest["tracking"] = null;
  if (b.tracking && Object.keys(b.tracking).length > 0) {
    const { company, number, url } = b.tracking;
    // Shopify: if url is given, number must be too.
    if (url && !number) return { error: "tracking_url_requires_number" };
    if (url && !/^https?:\/\//i.test(url)) return { error: "invalid_tracking_url" };
    tracking = { ...(company ? { company } : {}), ...(number ? { number } : {}), ...(url ? { url } : {}) };
  }

  return { request: { fulfillmentOrderId, lines, tracking, notifyCustomer: b.notify_customer === true } };
}

/**
 * POST /v1/fulfillments — create a fulfillment for one fulfillment order.
 * Requires an Idempotency-Key header. notify_customer defaults to false; dry_run saves
 * the action and returns what would be sent, without calling Shopify.
 */
export function fulfillmentsRoutes(app: FastifyInstance, deps: FulfillmentRouteDeps) {
  app.post<{ Body: Body }>("/v1/fulfillments", { schema: { body } }, async (request, reply) => {
    const raw = request.headers["idempotency-key"];
    const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!key || !IDEMPOTENCY_KEY.test(key)) return reply.code(400).send({ error: "invalid_idempotency_key" });

    const normalized = normalizeRequest(request.body);
    if ("error" in normalized) return reply.code(400).send({ error: normalized.error });

    const dryRun = request.body.dry_run === true;
    if (!dryRun && !deps.enqueueOnClient) return reply.code(503).send({ error: "fulfillments_not_configured" });

    const result = await createFulfillmentAction(deps.pool, deps.enqueueOnClient, { key, request: normalized.request, dryRun });
    switch (result.kind) {
      case "key_reused":
        return reply.code(409).send({ error: "idempotency_key_reused" });
      case "rejected":
        return reply.code(422).send({ error: result.reason });
      case "replayed":
        return reply.code(200).send({ action: result.action, replayed: true, ...(result.wouldSend ? { wouldSend: result.wouldSend } : {}) });
      case "created":
        return reply
          .code(dryRun ? 200 : 202)
          .send({ action: result.action, ...(result.wouldSend ? { wouldSend: result.wouldSend } : {}) });
    }
  });

  app.get<{ Params: { key: string } }>("/v1/fulfillments/:key", async (request, reply) => {
    const action = await getFulfillmentAction(deps.pool, request.params.key);
    if (!action) return reply.code(404).send({ error: "not_found" });
    return { action };
  });
}
