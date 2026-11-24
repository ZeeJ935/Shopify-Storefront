import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { isValidServiceToken } from "../auth.js";
import { createFulfillmentAction, getFulfillmentAction, type EnqueueActionOnClient } from "../fulfillments/actions.js";
import type { ReportError } from "../report.js";
import { fulfillmentBodySchema, normalizeRequest, readIdempotencyKey, type FulfillmentBody } from "../routes/fulfillments.js";
import { inventoryRoutes } from "../routes/inventory.js";
import { ordersRoutes } from "../routes/orders.js";
import { roleAtLeast, roleFor, type StaffRole } from "./allowlist.js";
import { adminSearch, adminSummary } from "./insights.js";
import { warehouseDiff } from "../warehouse/diff.js";
import type { WarehouseEnv } from "../warehouse/env.js";
import { MAX_WAREHOUSE_QUANTITY, type MockWarehouse } from "../warehouse/mock.js";
import { createPush, getPush, MAX_PUSH_SKUS, type EnqueueItem } from "../warehouse/push.js";
import { emailHash, type AuditEntry, type AuditOutcome, type AuditStore } from "./audit.js";
import type { AdminEnv } from "./env.js";
import { GoogleTokenError, type GoogleVerifier } from "./google.js";
import { STAFF_SESSION_MAX_SECONDS, signStaffToken, StaffTokenError, verifyStaffToken, type StaffKeys } from "./jwt.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import type { StaffStore } from "./staff.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set on staff-authenticated /admin routes. Role is the CURRENT allowlist role. */
    staff?: { id: number; email: string; role: StaffRole; sessionExpiresAt: number; tokenExpiresAt: number };
  }
}

export const SYNC_KINDS = ["catalog", "inventory", "orders"] as const;
type SyncKind = (typeof SYNC_KINDS)[number];

export type AdminRouteDeps = {
  env: AdminEnv;
  pool: pg.Pool;
  verifyGoogle: GoogleVerifier;
  staff: StaffStore;
  audit: AuditStore;
  report?: ReportError;
  now?: () => number;
  /** Defaults: exchange 10/min, refresh 30/min per client IP. */
  rateLimits?: { exchange: RateLimiter; refresh: RateLimiter };
  /** Full-sync enqueuers (absent when that sync isn't configured). */
  sync?: Partial<Record<SyncKind, (reason: string) => Promise<unknown>>>;
  /** Fulfillment job queue (absent when Admin API isn't configured: dry runs only). */
  enqueueFulfillment?: EnqueueActionOnClient;
  /** Mock warehouse sync. Enqueuers are absent when the Shopify Admin API isn't configured. */
  warehouse?: {
    adapter: MockWarehouse;
    env: WarehouseEnv;
    enqueueItem?: EnqueueItem;
    enqueueReconcile?: () => Promise<unknown>;
  };
};

const warehousePushSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    skus: { type: "array", minItems: 1, maxItems: MAX_PUSH_SKUS, items: { type: "string", minLength: 1, maxLength: 100 } },
    all: { type: "boolean" },
    allow_large_decrease: { type: "boolean" },
    dry_run: { type: "boolean" },
  },
} as const;
type WarehousePushBody = { skus?: string[]; all?: boolean; allow_large_decrease?: boolean; dry_run?: boolean };

const warehouseStockSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sku", "location_id", "quantity"],
  properties: {
    sku: { type: "string", minLength: 1, maxLength: 100 },
    location_id: { type: "string", minLength: 1, maxLength: 100 },
    quantity: { type: "integer", minimum: 0, maximum: MAX_WAREHOUSE_QUANTITY },
  },
} as const;
type WarehouseStockBody = { sku: string; location_id: string; quantity: number };

const toLocationGid = (id: string) => (/^\d{1,20}$/.test(id) ? `gid://shopify/Location/${id}` : /^gid:\/\/shopify\/Location\/\d{1,20}$/.test(id) ? id : null);

/** One response for every sign-in/refresh failure, so callers learn nothing (e.g. allowlist membership). */
const SIGN_IN_FAILED = { error: "sign_in_failed" } as const;
const IP = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The browser never calls the backend, so request.ip is the admin app's server.
 * The admin app forwards the browser IP in x-admin-client-ip; it is only trusted
 * after the admin token check (this runs in a preHandler).
 */
function clientIp(request: FastifyRequest): string {
  const h = request.headers["x-admin-client-ip"];
  const v = (Array.isArray(h) ? h[0] : h)?.trim();
  return v && IP.test(v) ? v : request.ip;
}

const header = (request: FastifyRequest, name: string) => {
  const v = request.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/**
 * Staff admin API under /admin/*. Separate from /v1: its own token (ADMIN_API_TOKEN),
 * plus a short-lived staff JWT (X-Staff-Token) issued here after Google sign-in.
 */
export function adminRoutes(app: FastifyInstance, deps: AdminRouteDeps) {
  const now = deps.now ?? Date.now;
  const keys: StaffKeys = { current: deps.env.jwtSecret, previous: deps.env.jwtSecretPrevious };
  const apiTokens = [deps.env.apiToken, deps.env.apiTokenPrevious].filter((t): t is string => Boolean(t));
  const limits = deps.rateLimits ?? {
    exchange: createRateLimiter({ max: 10, windowMs: 60_000 }),
    refresh: createRateLimiter({ max: 30, windowMs: 60_000 }),
  };

  /** Best-effort audit (sign-ins, denials): never blocks the response. */
  const auditBestEffort = async (entry: AuditEntry) => {
    try {
      await deps.audit.insert(entry);
    } catch (error) {
      deps.report?.(error, { kind: "audit", action: entry.action });
    }
  };

  const staffFields = (request: FastifyRequest) => ({
    staffId: request.staff?.id ?? null,
    staffEmail: request.staff?.email ?? null,
    role: request.staff?.role ?? null,
    requestId: request.id,
  });

  const rateLimit = (limiter: RateLimiter) => async (request: FastifyRequest, reply: FastifyReply) => {
    const retryAfter = limiter.hit(clientIp(request));
    if (retryAfter > 0) return reply.code(429).header("retry-after", String(retryAfter)).send({ error: "rate_limited" });
  };

  const requireRole = (required: StaffRole, action: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.staff && roleAtLeast(request.staff.role, required)) return;
    await auditBestEffort({
      ...staffFields(request),
      action,
      result: "denied",
      statusCode: 403,
      detail: { required_role: required, route: request.routeOptions.url },
    });
    return reply.code(403).send({ error: "forbidden" });
  };

  /**
   * Fail-closed auditing for changes: a "pending" row is written BEFORE the action;
   * if that write fails the action is refused (503). The row is then completed with
   * the outcome (a failed completion is reported; the row stays "pending").
   */
  async function audited(
    request: FastifyRequest,
    reply: FastifyReply,
    meta: Pick<AuditEntry, "action" | "resourceType" | "resourceId" | "detail">,
    run: () => Promise<AuditOutcome & { body: unknown }>,
  ) {
    let auditId: number;
    try {
      auditId = await deps.audit.insert({ ...staffFields(request), ...meta, result: "pending" });
    } catch (error) {
      deps.report?.(error, { kind: "audit", action: meta.action });
      return reply.code(503).send({ error: "audit_unavailable" });
    }
    let outcome: AuditOutcome & { body: unknown };
    try {
      outcome = await run();
    } catch (error) {
      await deps.audit.complete(auditId, { result: "error", statusCode: 500 }).catch((e) => deps.report?.(e, { kind: "audit" }));
      throw error;
    }
    const { body, ...rest } = outcome;
    await deps.audit.complete(auditId, rest).catch((e) => deps.report?.(e, { kind: "audit", action: meta.action }));
    return reply.code(outcome.statusCode).send(body);
  }

  app.register(async (adm) => {
    // Every /admin route: the admin app's server token (current or, during rotation, previous).
    adm.addHook("onRequest", async (request, reply) => {
      if (!apiTokens.some((t) => isValidServiceToken(request.headers.authorization, t))) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    adm.post("/admin/auth/exchange", { preHandler: rateLimit(limits.exchange) }, async (request, reply) => {
      const body = (request.body ?? {}) as { idToken?: unknown; nonce?: unknown };
      const idToken = typeof body.idToken === "string" && body.idToken.length <= 8192 ? body.idToken : null;
      const nonce = typeof body.nonce === "string" && body.nonce.length >= 16 && body.nonce.length <= 256 ? body.nonce : null;
      const reject = async (reason: string, extra: Record<string, unknown> = {}) => {
        await auditBestEffort({ action: "auth.login", result: "rejected", statusCode: 401, requestId: request.id, detail: { reason, ...extra } });
        return reply.code(401).send(SIGN_IN_FAILED);
      };
      if (!idToken || !nonce) return reject("bad_request");

      let identity;
      try {
        identity = await deps.verifyGoogle(idToken, nonce);
      } catch (error) {
        if (!(error instanceof GoogleTokenError)) deps.report?.(error, { kind: "admin_auth", step: "google_verify" });
        return reject(error instanceof GoogleTokenError ? error.reason : "verify_error");
      }

      const email = identity.email.trim().toLowerCase();
      const role = roleFor(deps.env.allowlist, email);
      if (!role) return reject("not_allowlisted", { email_hash: emailHash(deps.env.jwtSecret, email) });

      const staffId = await deps.staff.upsertOnLogin({ email, googleSub: identity.sub, role });
      const sessionStartedAt = Math.floor(now() / 1000);
      const { token, expiresAt } = await signStaffToken(keys, { staffId, email, role, sessionStartedAt }, now());
      await auditBestEffort({ staffId, staffEmail: email, role, action: "auth.login", result: "success", statusCode: 200, requestId: request.id });
      return {
        token,
        expiresAt,
        sessionExpiresAt: sessionStartedAt + STAFF_SESSION_MAX_SECONDS,
        staff: { id: staffId, email, role },
      };
    });

    adm.post("/admin/auth/refresh", { preHandler: rateLimit(limits.refresh) }, async (request, reply) => {
      const token = header(request, "x-staff-token");
      if (!token) return reply.code(401).send(SIGN_IN_FAILED);
      let claims;
      try {
        // Signature, issuer, audience and the 8-hour session limit are always checked.
        claims = await verifyStaffToken(keys, token, { allowExpired: true, now: now() });
      } catch {
        return reply.code(401).send(SIGN_IN_FAILED);
      }
      const role = roleFor(deps.env.allowlist, claims.email);
      if (!role || !(await deps.staff.exists(claims.staffId, claims.email))) {
        await auditBestEffort({
          staffId: claims.staffId,
          staffEmail: claims.email,
          role: claims.role,
          action: "auth.refresh",
          result: "denied",
          statusCode: 401,
          requestId: request.id,
          detail: { reason: role ? "staff_missing" : "not_allowlisted" },
        });
        return reply.code(401).send(SIGN_IN_FAILED);
      }
      let signed;
      try {
        signed = await signStaffToken(keys, { staffId: claims.staffId, email: claims.email, role, sessionStartedAt: claims.sessionStartedAt }, now());
      } catch {
        return reply.code(401).send(SIGN_IN_FAILED);
      }
      return {
        token: signed.token,
        expiresAt: signed.expiresAt,
        sessionExpiresAt: claims.sessionStartedAt + STAFF_SESSION_MAX_SECONDS,
        staff: { id: claims.staffId, email: claims.email, role },
      };
    });

    // Staff-authenticated routes.
    adm.register(async (s) => {
      s.addHook("onRequest", async (request, reply) => {
        const token = header(request, "x-staff-token");
        try {
          if (!token) throw new StaffTokenError("missing");
          const claims = await verifyStaffToken(keys, token, { now: now() });
          // The allowlist decides: removed → out; role changed → the new role applies now.
          const role = roleFor(deps.env.allowlist, claims.email);
          if (!role) throw new StaffTokenError("not_allowlisted");
          request.staff = {
            id: claims.staffId,
            email: claims.email,
            role,
            sessionExpiresAt: claims.sessionStartedAt + STAFF_SESSION_MAX_SECONDS,
            tokenExpiresAt: claims.expiresAt,
          };
        } catch {
          return reply.code(401).send({ error: "unauthorized" });
        }
      });

      s.get("/admin/me", async (request) => ({ staff: request.staff }));

      // Dashboard counts and staff search (viewer+; read-only, no customer data).
      s.get("/admin/summary", async () => adminSummary(deps.pool));
      s.get("/admin/search", async (request) => {
        const q = (request.query as { q?: unknown }).q;
        return adminSearch(deps.pool, typeof q === "string" ? q : "");
      });

      // Reads (viewer+): same handlers as /v1, without their sync endpoints.
      ordersRoutes(s, { pool: deps.pool }, { base: "/admin", sync: false });
      inventoryRoutes(s, { pool: deps.pool }, { base: "/admin", sync: false });

      s.get<{ Params: { key: string } }>("/admin/fulfillments/:key", async (request, reply) => {
        const action = await getFulfillmentAction(deps.pool, request.params.key);
        if (!action) return reply.code(404).send({ error: "not_found" });
        return { action };
      });

      s.get("/admin/audit", { preHandler: requireRole("admin", "audit.read") }, async (request) => {
        const q = request.query as { before?: string; limit?: string };
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
        const before = q.before && /^\d+$/.test(q.before) ? Number(q.before) : null;
        const entries = await deps.audit.list({ before, limit });
        return { entries, nextBefore: entries.length === limit ? entries[entries.length - 1].id : null };
      });

      // Changes (fail-closed audit).
      s.post<{ Body: FulfillmentBody }>(
        "/admin/fulfillments",
        { preHandler: requireRole("operator", "fulfillment.create"), schema: { body: fulfillmentBodySchema } },
        async (request, reply) => {
          const key = readIdempotencyKey(request);
          if (!key) return reply.code(400).send({ error: "invalid_idempotency_key" });
          const normalized = normalizeRequest(request.body);
          if ("error" in normalized) return reply.code(400).send({ error: normalized.error });
          const dryRun = request.body.dry_run === true;
          const req = normalized.request;

          return audited(
            request,
            reply,
            {
              action: "fulfillment.create",
              resourceType: "fulfillment_order",
              resourceId: req.fulfillmentOrderId,
              detail: { idempotency_key: key, dry_run: dryRun, notify_customer: req.notifyCustomer, line_count: req.lines?.length ?? null },
            },
            async () => {
              if (!dryRun && !deps.enqueueFulfillment) {
                return { result: "rejected", statusCode: 503, detail: { reason: "fulfillments_not_configured" }, body: { error: "fulfillments_not_configured" } };
              }
              const result = await createFulfillmentAction(deps.pool, deps.enqueueFulfillment, {
                key,
                request: req,
                dryRun,
                createdByStaffId: request.staff!.id,
              });
              switch (result.kind) {
                case "key_reused":
                  return { result: "rejected", statusCode: 409, detail: { reason: "idempotency_key_reused" }, body: { error: "idempotency_key_reused" } };
                case "rejected":
                  return { result: "rejected", statusCode: 422, detail: { reason: result.reason }, body: { error: result.reason } };
                case "replayed":
                  return {
                    result: "success",
                    statusCode: 200,
                    detail: { replayed: true },
                    body: { action: result.action, replayed: true, ...(result.wouldSend ? { wouldSend: result.wouldSend } : {}) },
                  };
                case "created":
                  return {
                    result: "success",
                    statusCode: dryRun ? 200 : 202,
                    body: { action: result.action, ...(result.wouldSend ? { wouldSend: result.wouldSend } : {}) },
                  };
              }
            },
          );
        },
      );

      // ---- Warehouse (mock) ----
      const wh = deps.warehouse;
      if (wh) {
        s.get("/admin/warehouse/diff", async (request) => {
          const only = (request.query as { only?: string }).only;
          const rows = await warehouseDiff(wh.adapter, deps.pool, { maxDecrease: wh.env.maxDecrease });
          const state = await deps.pool.query<{ last_reconcile_at: Date | null }>("select last_reconcile_at from warehouse_state where id = 1");
          return {
            mode: wh.env.pushMode,
            maxDecrease: wh.env.maxDecrease,
            lastReconcileAt: state.rows[0]?.last_reconcile_at?.toISOString() ?? null,
            rows: only === "differences" ? rows.filter((r) => r.status !== "match") : rows,
          };
        });

        s.get<{ Params: { key: string } }>("/admin/warehouse/pushes/:key", async (request, reply) => {
          const found = await getPush(deps.pool, request.params.key);
          if (!found) return reply.code(404).send({ error: "not_found" });
          return found;
        });

        s.post<{ Body: WarehousePushBody }>(
          "/admin/warehouse/push",
          { preHandler: requireRole("operator", "warehouse.push"), schema: { body: warehousePushSchema } },
          async (request, reply) => {
            const key = readIdempotencyKey(request);
            if (!key) return reply.code(400).send({ error: "invalid_idempotency_key" });
            const b = request.body;
            if (Boolean(b.skus) === Boolean(b.all)) return reply.code(400).send({ error: "send_either_skus_or_all" });
            const pushRequest = {
              skus: b.skus ? [...new Set(b.skus)].sort() : null,
              all: b.all === true,
              allowLargeDecrease: b.allow_large_decrease === true,
              dryRun: b.dry_run === true,
            };
            return audited(
              request,
              reply,
              {
                action: "warehouse.push",
                resourceType: "warehouse_push",
                resourceId: key,
                detail: { idempotency_key: key, dry_run: pushRequest.dryRun, allow_large_decrease: pushRequest.allowLargeDecrease, push_mode: wh.env.pushMode },
              },
              async () => {
                if (!wh.enqueueItem) {
                  return { result: "rejected", statusCode: 503, detail: { reason: "warehouse_not_configured" }, body: { error: "warehouse_not_configured" } };
                }
                const result = await createPush(deps.pool, { adapter: wh.adapter, env: wh.env, enqueue: wh.enqueueItem }, { key, request: pushRequest, staffId: request.staff!.id });
                switch (result.kind) {
                  case "key_reused":
                    return { result: "rejected", statusCode: 409, detail: { reason: "idempotency_key_reused" }, body: { error: "idempotency_key_reused" } };
                  case "nothing_to_push":
                    return { result: "rejected", statusCode: 422, detail: { reason: "nothing_to_push" }, body: { error: "nothing_to_push" } };
                  case "replayed":
                    return { result: "success", statusCode: 200, detail: { replayed: true }, body: { push: result.push, replayed: true, mode: wh.env.pushMode } };
                  case "created":
                    return { result: "success", statusCode: 202, detail: { item_count: result.push.itemCount }, body: { push: result.push, mode: wh.env.pushMode } };
                }
              },
            );
          },
        );

        s.put<{ Body: WarehouseStockBody }>(
          "/admin/warehouse/stock",
          { preHandler: requireRole("admin", "warehouse.stock"), schema: { body: warehouseStockSchema } },
          async (request, reply) => {
            const loc = toLocationGid(request.body.location_id);
            if (!loc) return reply.code(400).send({ error: "invalid_location_id" });
            const sku = request.body.sku.trim();
            return audited(
              request,
              reply,
              { action: "warehouse.stock", resourceType: "warehouse_stock", resourceId: `${sku}@${loc}`, detail: { sku, quantity: request.body.quantity } },
              async () => {
                const known = await deps.pool.query("select 1 from locations where shopify_id = $1", [loc]);
                if (!known.rowCount) return { result: "rejected", statusCode: 422, detail: { reason: "unknown_location" }, body: { error: "unknown_location" } };
                const before = await deps.pool.query<{ quantity: number }>("select quantity from warehouse_stock where sku = $1 and location_shopify_id = $2", [sku, loc]);
                const stock = await wh.adapter.setStock({ sku, locationShopifyId: loc, quantity: request.body.quantity, staffId: request.staff!.id });
                return {
                  result: "success",
                  statusCode: 200,
                  detail: { previous_quantity: before.rows[0]?.quantity ?? null },
                  body: { stock, previousQuantity: before.rows[0]?.quantity ?? null },
                };
              },
            );
          },
        );

        s.post("/admin/warehouse/reconcile", { preHandler: requireRole("admin", "warehouse.reconcile") }, async (request, reply) =>
          audited(request, reply, { action: "warehouse.reconcile", resourceType: "warehouse", resourceId: "reconcile" }, async () => {
            if (!wh.enqueueReconcile) return { result: "rejected", statusCode: 503, detail: { reason: "warehouse_not_configured" }, body: { error: "warehouse_not_configured" } };
            await wh.enqueueReconcile();
            return { result: "success", statusCode: 202, body: { queued: true } };
          }),
        );
      }

      s.post<{ Params: { kind: string } }>(
        "/admin/sync/:kind",
        { preHandler: requireRole("admin", "sync") },
        async (request, reply) => {
          const kind = request.params.kind as SyncKind;
          if (!SYNC_KINDS.includes(kind)) return reply.code(404).send({ error: "not_found" });
          return audited(request, reply, { action: `sync.${kind}`, resourceType: "sync", resourceId: kind }, async () => {
            const enqueue = deps.sync?.[kind];
            if (!enqueue) return { result: "rejected", statusCode: 503, detail: { reason: "not_configured" }, body: { error: `${kind}_sync_not_configured` } };
            await enqueue("manual");
            return { result: "success", statusCode: 202, detail: { queue: kind }, body: { queued: true } };
          });
        },
      );
    });
  });
}
