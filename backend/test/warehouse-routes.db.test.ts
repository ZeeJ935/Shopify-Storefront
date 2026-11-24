// Real Postgres (throwaway database): /admin/warehouse routes end to end. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseAllowlist } from "../src/admin/allowlist.js";
import { createAuditStore, type AuditStore } from "../src/admin/audit.js";
import type { GoogleVerifier } from "../src/admin/google.js";
import { createStaffStore } from "../src/admin/staff.js";
import { MockWarehouse } from "../src/warehouse/mock.js";
import type { EnqueueItem } from "../src/warehouse/push.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const url = process.env.DATABASE_URL;
const ADMIN = "admin-api-" + "a".repeat(40);
const NONCE = "nonce-" + "n".repeat(30);
const LOC = "gid://shopify/Location/7";
const ITEM = "gid://shopify/InventoryItem/701";

describe.skipIf(!url)("/admin/warehouse routes (Postgres)", () => {
  const dbName = `warehouse_routes_${randomUUID().slice(0, 8)}`;
  const root = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const realAudit = createAuditStore(pool);
  let auditFails = false;
  const audit: AuditStore = {
    insert: (e) => (auditFails ? Promise.reject(new Error("audit db down")) : realAudit.insert(e)),
    complete: (id, o) => realAudit.complete(id, o),
    list: (o) => realAudit.list(o),
  };
  let enqueued: { pushId: number; itemGid: string }[] = [];
  const enqueueItem: EnqueueItem = async (_c, data) => {
    enqueued.push(data);
    return randomUUID();
  };
  let reconciles = 0;
  const verifyGoogle: GoogleVerifier = async (idToken) => {
    const [sub, email] = idToken.split("|");
    return { sub, email, hostedDomain: null };
  };
  let app: ReturnType<typeof buildApp>;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    await root.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    app = buildApp({
      serviceToken: "service-" + "s".repeat(40),
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      webhooks: fakeWebhooks().deps,
      pingDb: async () => {},
      logger: false,
      staffAdmin: {
        env: { apiToken: ADMIN, jwtSecret: "jwt-" + "j".repeat(40), allowlist: parseAllowlist("v@x.com:viewer,o@x.com:operator,a@x.com:admin"), googleClientId: "c" },
        pool,
        verifyGoogle,
        staff: createStaffStore(pool),
        audit,
        warehouse: {
          adapter: new MockWarehouse(pool),
          env: { pushMode: "dry_run", maxDecrease: 10 },
          enqueueItem,
          enqueueReconcile: async () => {
            reconciles++;
          },
        },
      },
    });
    for (const who of ["v", "o", "a"]) {
      const res = await app.inject({ method: "POST", url: "/admin/auth/exchange", headers: { authorization: `Bearer ${ADMIN}` }, payload: { idToken: `g-${who}|${who}@x.com`, nonce: NONCE } });
      tokens[who] = res.json().token;
    }
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await root.query(`drop database if exists ${dbName}`);
    await root.end();
  });
  beforeEach(async () => {
    enqueued = [];
    auditFails = false;
    await pool.query("truncate warehouse_pushes, warehouse_stock, inventory_levels, inventory_items, locations restart identity cascade");
    await pool.query("insert into locations (shopify_id, name) values ($1, 'Main')", [LOC]);
    const { rows } = await pool.query("insert into inventory_items (shopify_id, sku) values ($1, 'SKU-7') returning id", [ITEM]);
    await pool.query("insert into inventory_levels (inventory_item_id, location_id, available, on_hand, committed) values ($1, 1, 18, 20, 2)", [rows[0].id]);
  });

  const call = (who: string, method: "GET" | "POST" | "PUT", path: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url: path, headers: { authorization: `Bearer ${ADMIN}`, "x-staff-token": tokens[who], ...headers }, ...(payload ? { payload } : {}) });
  const setStock = (who: string, quantity: number, location = "7") => call(who, "PUT", "/admin/warehouse/stock", { sku: "SKU-7", location_id: location, quantity });
  const push = (who: string, body: object, key = `push-${randomUUID()}`) => call(who, "POST", "/admin/warehouse/push", body, { "idempotency-key": key });

  it("roles: viewer reads the diff; operator pushes; only admin edits stock", async () => {
    expect((await setStock("o", 25)).statusCode).toBe(403);
    const edited = await setStock("a", 25);
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ stock: { sku: "SKU-7", locationShopifyId: LOC, quantity: 25 }, previousQuantity: null });
    expect((await setStock("a", 26)).json().previousQuantity).toBe(25);

    const diff = await call("v", "GET", "/admin/warehouse/diff");
    expect(diff.statusCode).toBe(200);
    expect(diff.json()).toMatchObject({ mode: "dry_run", maxDecrease: 10 });
    expect(diff.json().rows[0]).toMatchObject({ sku: "SKU-7", onHand: 20, available: 18, committed: 2, warehouseQuantity: 26, difference: 6, status: "differs" });

    expect((await push("v", { all: true })).statusCode).toBe(403);
    const ok = await push("o", { all: true });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toMatchObject({ mode: "dry_run", push: { status: "queued", itemCount: 1 } });
    expect(enqueued).toEqual([{ pushId: 1, itemGid: ITEM }]);
    expect((await call("o", "POST", "/admin/warehouse/reconcile")).statusCode).toBe(403);
    expect((await call("a", "POST", "/admin/warehouse/reconcile")).statusCode).toBe(202);
    expect(reconciles).toBe(1);

    const denied = await pool.query("select action, role from audit_log where result = 'denied' order by id");
    expect(denied.rows).toEqual([
      { action: "warehouse.stock", role: "operator" },
      { action: "warehouse.push", role: "viewer" },
      { action: "warehouse.reconcile", role: "operator" },
    ]);
  });

  it("audit before action: no audit row → 503, and no push or job is created", async () => {
    await setStock("a", 25);
    auditFails = true;
    const res = await push("o", { all: true });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "audit_unavailable" });
    expect((await pool.query("select count(*)::int as c from warehouse_pushes")).rows[0].c).toBe(0);
    expect(enqueued).toEqual([]);
    expect((await setStock("a", 30)).statusCode).toBe(503); // stock edits fail closed too
    auditFails = false;
    expect((await call("v", "GET", "/admin/warehouse/diff")).json().rows[0].warehouseQuantity).toBe(25);
  });

  it("pending audit row first, then completed; idempotent replay and 409 over HTTP", async () => {
    await setStock("a", 25);
    const first = await push("o", { all: true, dry_run: true }, "http-push-0001");
    expect(first.statusCode).toBe(202);
    const again = await push("o", { all: true, dry_run: true }, "http-push-0001");
    expect(again.statusCode).toBe(200);
    expect(again.json().replayed).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect((await push("o", { all: true }, "http-push-0001")).statusCode).toBe(409);
    const rows = await pool.query("select result, status_code, detail, completed_at is not null as done from audit_log where action = 'warehouse.push' and resource_id = 'http-push-0001' order by id");
    expect(rows.rows.map((r) => [r.result, r.status_code, r.done])).toEqual([
      ["success", 202, true],
      ["success", 200, true],
      ["rejected", 409, true],
    ]);
    expect(rows.rows[0].detail).toMatchObject({ idempotency_key: "http-push-0001", dry_run: true, push_mode: "dry_run", item_count: 1 });
    const status = await call("v", "GET", "/admin/warehouse/pushes/http-push-0001");
    expect(status.json().push).toMatchObject({ key: "http-push-0001", dryRun: true, itemCount: 1 });
  });

  it("validation: key required, skus xor all, nothing to push, unknown location", async () => {
    expect((await call("o", "POST", "/admin/warehouse/push", { all: true })).json()).toEqual({ error: "invalid_idempotency_key" });
    expect((await push("o", { all: true, skus: ["SKU-7"] })).json()).toEqual({ error: "send_either_skus_or_all" });
    expect((await push("o", {})).json()).toEqual({ error: "send_either_skus_or_all" });
    expect((await push("o", { all: true, extra: 1 })).statusCode).toBe(400);
    expect((await push("o", { all: true })).json()).toEqual({ error: "nothing_to_push" }); // no warehouse rows yet
    expect((await setStock("a", 5, "999")).json()).toEqual({ error: "unknown_location" });
    expect((await call("a", "PUT", "/admin/warehouse/stock", { sku: "SKU-7", location_id: "7", quantity: -1 })).statusCode).toBe(400);
    await setStock("a", 20);
    expect((await call("v", "GET", "/admin/warehouse/diff?only=differences")).json().rows).toEqual([]); // match is filtered out
  });
});
