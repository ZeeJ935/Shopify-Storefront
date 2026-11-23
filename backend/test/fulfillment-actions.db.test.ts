// Real Postgres, in a throwaway database. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { FulfillmentActionsShopify, FulfillmentCreateInput, LiveFulfillmentOrder } from "../src/fulfillments/actions-admin.js";
import {
  createFulfillmentAction,
  markFulfillmentActionFailed,
  runFulfillmentAction,
  type FulfillmentRequest,
} from "../src/fulfillments/actions.js";
import { createFulfillmentsStore } from "../src/fulfillments/store.js";
import { createOrdersStore } from "../src/orders/store.js";
import type { RemoteOrder } from "../src/orders/types.js";
import { ShopifyUserErrors } from "../src/shopify-admin/index.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const url = process.env.DATABASE_URL;
const TOKEN = "service-token-" + "d".repeat(40);
const ORDER = "gid://shopify/Order/9001";
const FO = "gid://shopify/FulfillmentOrder/9101";
const LINE1 = "gid://shopify/FulfillmentOrderLineItem/9201";
const LINE2 = "gid://shopify/FulfillmentOrderLineItem/9202";

const req = (lines: FulfillmentRequest["lines"] = [{ id: LINE1, quantity: 1 }]): FulfillmentRequest => ({
  fulfillmentOrderId: FO,
  lines,
  tracking: null,
  notifyCustomer: false,
});

/** Fake Shopify: live FO state + records every create call. */
function fakeShopify(live: Partial<LiveFulfillmentOrder> | null, create?: () => Promise<{ id: string; status: string | null }>) {
  const creates: FulfillmentCreateInput[] = [];
  const shopify: FulfillmentActionsShopify = {
    async liveFulfillmentOrder() {
      if (!live) return null;
      return {
        orderId: ORDER,
        status: "OPEN",
        remaining: new Map([
          [LINE1, 2],
          [LINE2, 1],
        ]),
        recentFulfillments: [],
        ...live,
      };
    },
    async createFulfillment(input) {
      creates.push(input);
      return create ? create() : { id: "gid://shopify/Fulfillment/1", status: "SUCCESS" };
    },
  };
  return { shopify, creates };
}

describe.skipIf(!url)("fulfillment actions in Postgres", () => {
  const dbName = `fulfillment_actions_test_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  let enqueued: number[] = [];
  const enqueue = async (_client: pg.PoolClient, id: number) => {
    enqueued.push(id);
  };
  const action = async (key: string) =>
    (await pool.query("select id, status, attempts, shopify_fulfillment_id, last_error, request from fulfillment_actions where idempotency_key = $1", [key]))
      .rows[0];

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  beforeEach(async () => {
    enqueued = [];
    await pool.query("truncate orders, fulfillment_actions restart identity cascade");
    await createOrdersStore(pool).upsertOrder({
      shopifyId: ORDER,
      name: "#9001",
      createdAt: null,
      updatedAt: "2026-03-01T00:00:00Z",
      processedAt: null,
      cancelledAt: null,
      closedAt: null,
      currency: "USD",
      subtotal: null,
      total: null,
      tax: null,
      discount: null,
      financialStatus: null,
      fulfillmentStatus: null,
      cancelReason: null,
      sourceName: null,
      test: true,
      lines: [],
    } satisfies RemoteOrder);
    const store = createFulfillmentsStore(pool);
    await store.replaceForOrder(
      {
        orderShopifyId: ORDER,
        fulfillmentOrders: [
          {
            shopifyId: FO,
            status: "OPEN",
            requestStatus: "UNSUBMITTED",
            assignedLocationShopifyId: null,
            fulfillAt: null,
            updatedAt: "2026-03-01T00:00:00Z",
            lines: [
              { shopifyId: LINE1, orderLineShopifyId: null, inventoryItemId: null, totalQuantity: 2, remainingQuantity: 2 },
              { shopifyId: LINE2, orderLineShopifyId: null, inventoryItemId: null, totalQuantity: 1, remainingQuantity: 1 },
            ],
          },
        ],
        fulfillments: [],
        fulfillmentsComplete: true,
      },
      await store.now(),
    );
  });

  it("dry run: saves the action, returns what would be sent, queues nothing", async () => {
    const r = await createFulfillmentAction(pool, enqueue, { key: "dry-key-0001", request: req(), dryRun: true });
    expect(r.kind).toBe("created");
    if (r.kind !== "created") return;
    expect(r.action.status).toBe("dry_run");
    expect(r.wouldSend).toEqual({
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: FO, fulfillmentOrderLineItems: [{ id: LINE1, quantity: 1 }] }],
      notifyCustomer: false,
    });
    expect(enqueued).toEqual([]);
    // A dry-run row is never picked up by the job.
    const { shopify, creates } = fakeShopify({});
    expect(await runFulfillmentAction({ pool, shopify }, Number((await action("dry-key-0001")).id))).toBe("skipped");
    expect(creates).toEqual([]);
  });

  it("idempotency: same key + body replays without a second job; different body is 409", async () => {
    const first = await createFulfillmentAction(pool, enqueue, { key: "real-key-0001", request: req(), dryRun: false });
    expect(first.kind).toBe("created");
    const again = await createFulfillmentAction(pool, enqueue, { key: "real-key-0001", request: req(), dryRun: false });
    expect(again.kind).toBe("replayed");
    expect(enqueued).toHaveLength(1);
    const other = await createFulfillmentAction(pool, enqueue, { key: "real-key-0001", request: req([{ id: LINE1, quantity: 2 }]), dryRun: false });
    expect(other.kind).toBe("key_reused");
    const asDry = await createFulfillmentAction(pool, enqueue, { key: "real-key-0001", request: req(), dryRun: true });
    expect(asDry.kind).toBe("key_reused");
  });

  it("two parallel requests with one key create one action and one job", async () => {
    const results = await Promise.all([
      createFulfillmentAction(pool, enqueue, { key: "race-key-0001", request: req(), dryRun: false }),
      createFulfillmentAction(pool, enqueue, { key: "race-key-0001", request: req(), dryRun: false }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["created", "replayed"]);
    expect((await pool.query("select count(*)::int as c from fulfillment_actions")).rows[0].c).toBe(1);
    expect(enqueued).toHaveLength(1);
  });

  it("rejects against synced data (422 reasons)", async () => {
    const reason = async (request: FulfillmentRequest) => {
      const r = await createFulfillmentAction(pool, enqueue, { key: `k-${randomUUID()}`, request, dryRun: true });
      return r.kind === "rejected" ? r.reason : r.kind;
    };
    expect(await reason({ ...req(), fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1" })).toBe("fulfillment_order_not_found");
    expect(await reason(req([{ id: LINE2, quantity: 2 }]))).toBe("quantity_exceeds_remaining");
    expect(await reason(req([{ id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 1 }]))).toBe("unknown_line");
    await pool.query("update fulfillment_orders set status = 'CLOSED'");
    expect(await reason(req())).toBe("fulfillment_order_not_open");
  });

  it("job success: calls fulfillmentCreate once (notifyCustomer false), stores the id, refreshes the order", async () => {
    await createFulfillmentAction(pool, enqueue, { key: "ok-key-00001", request: req(), dryRun: false });
    const refreshed: string[] = [];
    const { shopify, creates } = fakeShopify({});
    const result = await runFulfillmentAction({ pool, shopify, refreshOrder: async (id) => refreshed.push(id) }, enqueued[0]);
    expect(result).toBe("succeeded");
    expect(creates).toHaveLength(1);
    expect(creates[0].notifyCustomer).toBe(false);
    expect(refreshed).toEqual([ORDER]);
    const row = await action("ok-key-00001");
    expect(row).toMatchObject({ status: "succeeded", attempts: 1, shopify_fulfillment_id: "gid://shopify/Fulfillment/1" });
    // Runs again (duplicate job) → skipped, no second create.
    expect(await runFulfillmentAction({ pool, shopify }, enqueued[0])).toBe("skipped");
    expect(creates).toHaveLength(1);
  });

  it("userErrors are final (no throw, no retry)", async () => {
    await createFulfillmentAction(pool, enqueue, { key: "ue-key-00001", request: req(), dryRun: false });
    const { shopify } = fakeShopify({}, async () => {
      throw new ShopifyUserErrors([{ field: ["fulfillment"], message: "Fulfillment order is not fulfillable" }]);
    });
    expect(await runFulfillmentAction({ pool, shopify }, enqueued[0])).toBe("failed");
    expect((await action("ue-key-00001")).last_error).toContain("not fulfillable");
  });

  it("a live check failure is final", async () => {
    await createFulfillmentAction(pool, enqueue, { key: "lc-key-00001", request: req(), dryRun: false });
    const { shopify, creates } = fakeShopify({ remaining: new Map([[LINE1, 0]]) });
    expect(await runFulfillmentAction({ pool, shopify }, enqueued[0])).toBe("failed");
    expect(creates).toEqual([]);
    expect((await action("lc-key-00001")).last_error).toContain("quantity_exceeds_remaining");
  });

  it("transient error after sending: the retry adopts the fulfillment instead of sending again", async () => {
    await createFulfillmentAction(pool, enqueue, { key: "tr-key-00001", request: req(), dryRun: false });
    const first = fakeShopify({}, async () => {
      throw new Error("Shopify Admin API request failed (TimeoutError)");
    });
    await expect(runFulfillmentAction({ pool, shopify: first.shopify }, enqueued[0])).rejects.toThrow(/TimeoutError/);
    expect((await action("tr-key-00001")).status).toBe("submitting");

    // Shopify did create it before the timeout: it shows up on the fulfillment order.
    const retry = fakeShopify({ recentFulfillments: [{ id: "gid://shopify/Fulfillment/77", createdAt: new Date().toISOString() }] });
    expect(await runFulfillmentAction({ pool, shopify: retry.shopify }, enqueued[0])).toBe("reconciled");
    expect(retry.creates).toEqual([]);
    expect(await action("tr-key-00001")).toMatchObject({ status: "succeeded", attempts: 2, shopify_fulfillment_id: "gid://shopify/Fulfillment/77" });
  });

  it("transient error before anything was created: the retry sends", async () => {
    await createFulfillmentAction(pool, enqueue, { key: "tr-key-00002", request: req(), dryRun: false });
    const first = fakeShopify({}, async () => {
      throw new Error("Shopify Admin API returned 503");
    });
    await expect(runFulfillmentAction({ pool, shopify: first.shopify }, enqueued[0])).rejects.toThrow();
    // An older fulfillment (before this attempt) must not be adopted.
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const retry = fakeShopify({ recentFulfillments: [{ id: "gid://shopify/Fulfillment/1", createdAt: old }] });
    expect(await runFulfillmentAction({ pool, shopify: retry.shopify }, enqueued[0])).toBe("succeeded");
    expect(retry.creates).toHaveLength(1);
  });

  it("final failure marks the action failed", async () => {
    await createFulfillmentAction(pool, enqueue, { key: "ff-key-00001", request: req(), dryRun: false });
    await markFulfillmentActionFailed(pool, enqueued[0], new Error("Shopify Admin API returned 503"));
    expect(await action("ff-key-00001")).toMatchObject({ status: "failed", last_error: "Error: Shopify Admin API returned 503" });
  });

  it("HTTP: dry run 200, replay, 409, GET status; stored request has no personal data", async () => {
    const app = buildApp({
      serviceToken: TOKEN,
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      webhooks: fakeWebhooks().deps,
      pingDb: async () => {},
      fulfillments: { pool, enqueueOnClient: enqueue },
      logger: false,
    });
    const headers = { authorization: `Bearer ${TOKEN}`, "idempotency-key": "http-key-0001" };
    const payload = { fulfillment_order_id: "9101", lines: [{ id: "9201", quantity: 1 }], tracking: { number: "1Z", company: "UPS" }, dry_run: true };

    const created = await app.inject({ method: "POST", url: "/v1/fulfillments", headers, payload });
    expect(created.statusCode).toBe(200);
    expect(created.json().action).toMatchObject({ key: "http-key-0001", status: "dry_run", dryRun: true, fulfillmentOrderId: FO });
    expect(created.json().wouldSend.notifyCustomer).toBe(false);

    const replay = await app.inject({ method: "POST", url: "/v1/fulfillments", headers, payload });
    expect(replay.json().replayed).toBe(true);
    const reused = await app.inject({ method: "POST", url: "/v1/fulfillments", headers, payload: { ...payload, dry_run: false } });
    expect(reused.statusCode).toBe(409);

    const got = await app.inject({ method: "GET", url: "/v1/fulfillments/http-key-0001", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(got.json().action.status).toBe("dry_run");
    expect((await app.inject({ method: "GET", url: "/v1/fulfillments/nope-0000", headers: { authorization: `Bearer ${TOKEN}` } })).statusCode).toBe(404);

    const stored = (await action("http-key-0001")).request;
    expect(Object.keys(stored).sort()).toEqual(["fulfillmentOrderId", "lines", "notifyCustomer", "tracking"]);
    expect(JSON.stringify(stored)).not.toMatch(/address|email|phone|destination/i);

    const real = await app.inject({
      method: "POST",
      url: "/v1/fulfillments",
      headers: { ...headers, "idempotency-key": "http-key-0002" },
      payload: { fulfillment_order_id: FO },
    });
    expect(real.statusCode).toBe(202);
    expect(real.json().action.status).toBe("pending");
    expect(enqueued).toHaveLength(1);
    await app.close();
  });
});
