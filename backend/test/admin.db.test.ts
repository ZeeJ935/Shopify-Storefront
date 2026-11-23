// Real Postgres (throwaway database): staff + audit_log + /admin fulfillments end to end.
// Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseAllowlist } from "../src/admin/allowlist.js";
import { createAuditStore } from "../src/admin/audit.js";
import type { GoogleVerifier } from "../src/admin/google.js";
import { createStaffStore } from "../src/admin/staff.js";
import { createFulfillmentsStore } from "../src/fulfillments/store.js";
import { createOrdersStore } from "../src/orders/store.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const url = process.env.DATABASE_URL;
const ADMIN = "admin-api-" + "a".repeat(40);
const NONCE = "nonce-" + "n".repeat(30);
const ORDER = "gid://shopify/Order/9501";
const FO = "gid://shopify/FulfillmentOrder/9601";
const LINE = "gid://shopify/FulfillmentOrderLineItem/9701";

describe.skipIf(!url)("staff admin in Postgres", () => {
  const dbName = `admin_test_${randomUUID().slice(0, 8)}`;
  const root = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const enqueued: number[] = [];
  // Fake Google: the id token "<sub>|<email>".
  const verifyGoogle: GoogleVerifier = async (idToken) => {
    const [sub, email] = idToken.split("|");
    return { sub, email, hostedDomain: null };
  };
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await root.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    await createOrdersStore(pool).upsertOrder({
      shopifyId: ORDER, name: "#9501", createdAt: null, updatedAt: "2026-03-01T00:00:00Z", processedAt: null, cancelledAt: null,
      closedAt: null, currency: "USD", subtotal: null, total: null, tax: null, discount: null, financialStatus: "PAID",
      fulfillmentStatus: "UNFULFILLED", cancelReason: null, sourceName: null, test: true, lines: [],
    });
    const fs = createFulfillmentsStore(pool);
    await fs.replaceForOrder(
      {
        orderShopifyId: ORDER,
        fulfillmentOrders: [{
          shopifyId: FO, status: "OPEN", requestStatus: "UNSUBMITTED", assignedLocationShopifyId: null, fulfillAt: null,
          updatedAt: "2026-03-01T00:00:00Z",
          lines: [{ shopifyId: LINE, orderLineShopifyId: null, inventoryItemId: null, totalQuantity: 1, remainingQuantity: 1 }],
        }],
        fulfillments: [],
        fulfillmentsComplete: true,
      },
      await fs.now(),
    );
    app = buildApp({
      serviceToken: "service-" + "s".repeat(40),
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      webhooks: fakeWebhooks().deps,
      pingDb: async () => {},
      logger: false,
      staffAdmin: {
        env: {
          apiToken: ADMIN,
          jwtSecret: "jwt-" + "j".repeat(40),
          allowlist: parseAllowlist("op@x.com:operator,admin@x.com:admin"),
          googleClientId: "client",
        },
        pool,
        verifyGoogle,
        staff: createStaffStore(pool),
        audit: createAuditStore(pool),
        enqueueFulfillment: async (_c, id) => {
          enqueued.push(id);
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await root.query(`drop database if exists ${dbName}`);
    await root.end();
  });

  const exchange = (idToken: string) =>
    app.inject({ method: "POST", url: "/admin/auth/exchange", headers: { authorization: `Bearer ${ADMIN}` }, payload: { idToken, nonce: NONCE } });
  const call = (method: "GET" | "POST", path: string, token: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url: path, headers: { authorization: `Bearer ${ADMIN}`, "x-staff-token": token, ...headers }, ...(payload ? { payload } : {}) });

  it("operator: dry run then real fulfillment, audited pending→success with created_by_staff_id", async () => {
    const login = await exchange("g-op|op@x.com");
    expect(login.statusCode).toBe(200);
    const { token, staff } = login.json();

    const dry = await call("POST", "/admin/fulfillments", token, { fulfillment_order_id: FO, dry_run: true }, { "idempotency-key": "admin-dry-0001" });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().wouldSend.notifyCustomer).toBe(false);
    const real = await call("POST", "/admin/fulfillments", token, { fulfillment_order_id: FO }, { "idempotency-key": "admin-real-0001" });
    expect(real.statusCode).toBe(202);
    expect(enqueued).toHaveLength(1);
    // Double click: same key → replay, no second job.
    const again = await call("POST", "/admin/fulfillments", token, { fulfillment_order_id: FO }, { "idempotency-key": "admin-real-0001" });
    expect(again.json().replayed).toBe(true);
    expect(enqueued).toHaveLength(1);

    const actions = await pool.query("select idempotency_key, created_by_staff_id::int as by from fulfillment_actions order by id");
    expect(actions.rows).toEqual([
      { idempotency_key: "admin-dry-0001", by: staff.id },
      { idempotency_key: "admin-real-0001", by: staff.id },
    ]);

    const rows = await pool.query(
      `select action, result, status_code, resource_type, resource_id, staff_email, role, detail, completed_at is not null as done
       from audit_log where action = 'fulfillment.create' order by id`,
    );
    expect(rows.rows.map((r) => [r.result, r.status_code, r.done])).toEqual([
      ["success", 200, true],
      ["success", 202, true],
      ["success", 200, true],
    ]);
    expect(rows.rows[1]).toMatchObject({ resource_type: "fulfillment_order", resource_id: FO, staff_email: "op@x.com", role: "operator" });
    expect(rows.rows[1].detail).toEqual({ idempotency_key: "admin-real-0001", dry_run: false, notify_customer: false, line_count: null });
    expect(rows.rows[2].detail.replayed).toBe(true);
  });

  it("reads work for staff; audit list is admin-only and holds no customer data", async () => {
    const op = (await exchange("g-op|op@x.com")).json().token;
    const admin = (await exchange("g-admin|admin@x.com")).json().token;
    const orders = await call("GET", "/admin/orders", op);
    expect(orders.statusCode).toBe(200);
    const detail = await call("GET", `/admin/orders/${encodeURIComponent(ORDER)}`, op);
    expect(detail.json().fulfillmentOrders[0].id).toBe(FO);
    expect((await call("GET", "/admin/audit", op)).statusCode).toBe(403);

    const list = await call("GET", "/admin/audit?limit=100", admin);
    expect(list.statusCode).toBe(200);
    const entries = list.json().entries as { detail: Record<string, unknown> | null; action: string }[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.action === "audit.read")).toBe(true); // the operator's denial
    const allowed = new Set(["reason", "dry_run", "idempotency_key", "replayed", "notify_customer", "line_count", "queue", "email_hash", "required_role", "route"]);
    for (const e of entries) for (const k of Object.keys(e.detail ?? {})) expect(allowed.has(k)).toBe(true);
    // Personal-data field names (notify_customer is a boolean flag, not customer data).
    expect(JSON.stringify(entries)).not.toMatch(/address|phone|first_?name|last_?name|customer_?(id|email|name)|destination/i);
  });

  it("summary and search (viewer+): counts, exact order match, SKU prefix, LIKE wildcards escaped", async () => {
    const op = (await exchange("g-op|op@x.com")).json().token;
    const summary = await call("GET", "/admin/summary", op);
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ unfulfilledOrders: 1, openFulfillmentOrders: 1, lowStockAt: 5 });

    const exact = (await call("GET", "/admin/search?q=%239501", op)).json();
    expect(exact.exactOrderId).toBe(ORDER);
    expect((await call("GET", "/admin/search?q=9501", op)).json().exactOrderId).toBe(ORDER);
    const none = (await call("GET", "/admin/search?q=%25", op)).json(); // "%" must not match everything
    expect(none.orders).toEqual([]);
    expect((await call("GET", "/admin/search?q=", op)).json()).toEqual({ exactOrderId: null, orders: [], skus: [] });
  });

  it("staff rows: one per Google account; an email change updates the same row", async () => {
    const store = createStaffStore(pool);
    const a = await store.upsertOnLogin({ email: "new@x.com", googleSub: "g-change", role: "viewer" });
    const b = await store.upsertOnLogin({ email: "renamed@x.com", googleSub: "g-change", role: "viewer" });
    expect(b).toBe(a);
    expect(await store.exists(a, "renamed@x.com")).toBe(true);
    expect(await store.exists(a, "new@x.com")).toBe(false);
  });

  it("a rejected sign-in stores only a hash of the email", async () => {
    expect((await exchange("g-x|stranger@x.com")).statusCode).toBe(401);
    const { rows } = await pool.query("select staff_email, detail from audit_log where action = 'auth.login' and result = 'rejected'");
    expect(rows).toHaveLength(1);
    expect(rows[0].staff_email).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain("stranger");
  });
});
