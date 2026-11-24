// Real Postgres + real pg-boss in a throwaway database. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWarehouseJobs } from "../src/warehouse/jobs.js";
import type { WarehouseEnv } from "../src/warehouse/env.js";
import { MockWarehouse } from "../src/warehouse/mock.js";
import { createPush, failPushItem, getPush, ItemBusyError, runPushItem, type EnqueueItem, type PushRequest } from "../src/warehouse/push.js";
import { pushIdempotencyKey, SET_ON_HAND_MUTATION, type StockShopify } from "../src/warehouse/shopify.js";

const url = process.env.DATABASE_URL;
const LOC = "gid://shopify/Location/1";
const ITEM_A = "gid://shopify/InventoryItem/101";
const ITEM_B = "gid://shopify/InventoryItem/102";
const live: WarehouseEnv = { pushMode: "live", maxDecrease: 10 };
const req = (over: Partial<PushRequest> = {}): PushRequest => ({ skus: null, all: true, allowLargeDecrease: false, dryRun: false, ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake Shopify with real compare-and-set semantics. `onRead` can simulate a sale after each read. */
function fakeShopify(onHand: Record<string, number>, opts: { onRead?: (key: string) => void; delayMs?: number } = {}) {
  const sets: Parameters<StockShopify["setOnHand"]>[0][] = [];
  const shopify: StockShopify = {
    async liveLevel(item, loc) {
      const key = `${item}|${loc}`;
      if (opts.delayMs) await sleep(opts.delayMs);
      if (!(key in onHand)) return null;
      const value = onHand[key];
      opts.onRead?.(key);
      return { onHand: value, available: value, committed: 0 };
    },
    async setOnHand(i) {
      sets.push(i);
      const key = `${i.itemGid}|${i.locationGid}`;
      if (onHand[key] !== i.changeFromQuantity) return "stale";
      onHand[key] = i.quantity;
      return "ok";
    },
  };
  return { shopify, sets, onHand };
}

describe.skipIf(!url)("warehouse push (Postgres + pg-boss)", () => {
  const dbName = `warehouse_test_${randomUUID().slice(0, 8)}`;
  const root = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  const adapter = new MockWarehouse(pool);
  let enqueued: { pushId: number; itemGid: string }[] = [];
  const fakeEnqueue: EnqueueItem = async (_c, data) => {
    enqueued.push(data);
    return randomUUID();
  };

  beforeAll(async () => {
    await root.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });
  afterAll(async () => {
    await pool.end();
    await root.query(`drop database if exists ${dbName} with (force)`);
    await root.end();
  });

  /** Mirror: item A (SKU-A) and item B (SKU-B) at LOC with on_hand 20; warehouse rows as given. */
  async function seed(warehouse: Record<string, number>) {
    enqueued = [];
    await pool.query("truncate warehouse_pushes, warehouse_stock, inventory_levels, inventory_items, locations restart identity cascade");
    await pool.query("insert into locations (shopify_id, name) values ($1, 'Main')", [LOC]);
    for (const [gid, sku] of [[ITEM_A, "SKU-A"], [ITEM_B, "SKU-B"]]) {
      const { rows } = await pool.query("insert into inventory_items (shopify_id, sku) values ($1, $2) returning id", [gid, sku]);
      await pool.query("insert into inventory_levels (inventory_item_id, location_id, available, on_hand) values ($1, 1, 20, 20)", [rows[0].id]);
    }
    for (const [sku, quantity] of Object.entries(warehouse)) await adapter.setStock({ sku, locationShopifyId: LOC, quantity, staffId: null });
  }

  async function pushAndRun(fake: ReturnType<typeof fakeShopify>, request = req(), env: WarehouseEnv = live) {
    const created = await createPush(pool, { adapter, env, enqueue: fakeEnqueue }, { key: `k-${randomUUID()}`, request, staffId: null });
    if (created.kind !== "created") throw new Error(created.kind);
    for (const job of enqueued) await runPushItem({ pool, adapter, shopify: fake.shopify, env }, job);
    return (await getPush(pool, created.push.key))!;
  }

  it("sets on_hand with compare-and-set (changeFromQuantity = live on_hand) and closes the push", async () => {
    await seed({ "SKU-A": 25 });
    const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20 });
    const { push, log } = await pushAndRun(fake);
    expect(fake.sets).toHaveLength(1);
    expect(fake.sets[0]).toMatchObject({ itemGid: ITEM_A, locationGid: LOC, quantity: 25, changeFromQuantity: 20 });
    expect(fake.sets[0].idempotencyKey).toBe(pushIdempotencyKey({ pushId: 1, itemGid: ITEM_A, locationGid: LOC, attempt: 1, from: 20 }));
    expect(fake.onHand[`${ITEM_A}|${LOC}`]).toBe(25);
    expect(log.map((l) => [l.result, l.from, l.to, l.final])).toEqual([["pushed", 20, 25, true]]);
    expect(push.status).toBe("done");
  });

  it("conflict: a sale between read and set is not overwritten; re-read and retry", async () => {
    await seed({ "SKU-A": 25 });
    let sold = false;
    const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20 }, {
      onRead: (key) => {
        if (!sold) {
          sold = true;
          fake.onHand[key] -= 1; // a sale lands right after our read
        }
      },
    });
    const { log } = await pushAndRun(fake);
    expect(log.map((l) => [l.result, l.from, l.attempt])).toEqual([
      ["conflict", 20, 1],
      ["pushed", 19, 2],
    ]);
    expect(fake.sets.map((s) => s.changeFromQuantity)).toEqual([20, 19]);
    expect(new Set(fake.sets.map((s) => s.idempotencyKey)).size).toBe(2); // a new key per conflict retry
  });

  it("conflict on every attempt: gives up after the retry limit and Shopify keeps the sales", async () => {
    await seed({ "SKU-A": 25 });
    const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20 }, { onRead: (key) => (fake.onHand[key] -= 1) });
    const { log, push } = await pushAndRun(fake);
    expect(log.map((l) => l.result)).toEqual(["conflict", "conflict", "conflict", "conflict_gave_up"]);
    expect(fake.onHand[`${ITEM_A}|${LOC}`]).toBe(16); // 4 sales, never set to 25
    expect(push.status).toBe("done");
  });

  it("dry run (push flag or global mode) sends no mutation", async () => {
    await seed({ "SKU-A": 25 });
    const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20 });
    expect((await pushAndRun(fake, req({ dryRun: true }))).log.map((l) => [l.result, l.from, l.to])).toEqual([["dry_run", 20, 25]]);
    expect((await pushAndRun(fake, req(), { pushMode: "dry_run", maxDecrease: 10 })).log.map((l) => l.result)).toEqual(["dry_run"]);
    expect(fake.sets).toEqual([]);
    expect(fake.onHand[`${ITEM_A}|${LOC}`]).toBe(20);
  });

  it("large decreases need the flag; no-change and unstocked items are skipped", async () => {
    await seed({ "SKU-A": 5, "SKU-B": 20 }); // A: −15, B: no change in the mirror? (equal → not pushable)
    const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20 });
    expect((await pushAndRun(fake)).log.map((l) => l.result)).toEqual(["skipped_large_decrease"]);
    expect(fake.sets).toEqual([]);
    expect((await pushAndRun(fake, req({ allowLargeDecrease: true }))).log.map((l) => l.result)).toEqual(["pushed"]);
    expect(fake.onHand[`${ITEM_A}|${LOC}`]).toBe(5);
    // Already equal live (e.g. synced by someone else since the diff) → skipped_no_change.
    await seed({ "SKU-A": 30 });
    const same = fakeShopify({ [`${ITEM_A}|${LOC}`]: 30 });
    expect((await pushAndRun(same)).log.map((l) => l.result)).toEqual(["skipped_no_change"]);
    const missing = fakeShopify({});
    expect((await pushAndRun(missing)).log.map((l) => l.result)).toEqual(["skipped_not_stocked"]);
  });

  it("idempotent: same key + request replays without new jobs; another request is key_reused; nothing to push", async () => {
    await seed({ "SKU-A": 25 });
    const deps = { adapter, env: live, enqueue: fakeEnqueue };
    expect((await createPush(pool, deps, { key: "same-key-0001", request: req(), staffId: null })).kind).toBe("created");
    expect(enqueued).toHaveLength(1);
    expect((await createPush(pool, deps, { key: "same-key-0001", request: req(), staffId: null })).kind).toBe("replayed");
    expect(enqueued).toHaveLength(1);
    expect((await createPush(pool, deps, { key: "same-key-0001", request: req({ dryRun: true }), staffId: null })).kind).toBe("key_reused");
    await seed({ "SKU-A": 20 });
    expect((await createPush(pool, deps, { key: "other-key-001", request: req(), staffId: null })).kind).toBe("nothing_to_push");
  });

  it("a job's final failure closes the item so the push still finishes", async () => {
    await seed({ "SKU-A": 25 });
    const created = await createPush(pool, { adapter, env: live, enqueue: fakeEnqueue }, { key: "fail-key-0001", request: req(), staffId: null });
    if (created.kind !== "created") throw new Error("expected created");
    await failPushItem(pool, enqueued[0], new Error("Shopify Admin API returned 503"));
    const { push, log } = (await getPush(pool, "fail-key-0001"))!;
    expect(push.status).toBe("done");
    expect(log[0]).toMatchObject({ result: "failed", final: true });
  });

  it("advisory lock: a second worker for the same item is refused", async () => {
    await seed({ "SKU-A": 25 });
    const created = await createPush(pool, { adapter, env: live, enqueue: fakeEnqueue }, { key: "lock-key-0001", request: req(), staffId: null });
    if (created.kind !== "created") throw new Error("expected created");
    const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20 }, { delayMs: 300 });
    const results = await Promise.allSettled([
      runPushItem({ pool, adapter, shopify: fake.shopify, env: live }, enqueued[0]),
      sleep(50).then(() => runPushItem({ pool, adapter, shopify: fake.shopify, env: live }, enqueued[0])),
    ]);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof ItemBusyError)).toHaveLength(1);
    expect(fake.sets).toHaveLength(1);
  });

  describe("with pg-boss (stately per item)", () => {
    let boss: PgBoss;
    beforeEach(async () => {
      boss?.stop({ graceful: false, timeout: 1 }).catch(() => {});
      boss = new PgBoss({ connectionString: testUrl, max: 4 });
      boss.on("error", () => {});
      await boss.start();
      await boss.deleteQueue("warehouse-push-item").catch(() => {});
    });
    afterAll(async () => {
      await boss?.stop({ graceful: false, timeout: 1000 });
    });

    it("an item with a queued job: the next push logs skipped_already_queued and finishes", async () => {
      await seed({ "SKU-A": 25 });
      const jobs = createWarehouseJobs(boss);
      // Create the queue without a worker (so the first job stays queued).
      await boss.createQueue("warehouse-push-item", { policy: "stately" });
      const deps = { adapter, env: live, enqueue: jobs.enqueueItemOnClient };
      const first = await createPush(pool, deps, { key: "queued-key-01", request: req(), staffId: null });
      const second = await createPush(pool, deps, { key: "queued-key-02", request: req(), staffId: null });
      expect(first.kind === "created" && first.push.status).toBe("queued");
      if (second.kind !== "created") throw new Error("expected created");
      expect(second.push.status).toBe("done"); // didn't hang
      const { log } = (await getPush(pool, "queued-key-02"))!;
      expect(log).toEqual([expect.objectContaining({ inventoryItemId: ITEM_A, result: "skipped_already_queued", final: true })]);
    });

    it("per-item ordering: two pushes for one item never run at once; other items run in parallel", async () => {
      await seed({ "SKU-A": 25, "SKU-B": 30 });
      const jobs = createWarehouseJobs(boss);
      const fake = fakeShopify({ [`${ITEM_A}|${LOC}`]: 20, [`${ITEM_B}|${LOC}`]: 20 }, { delayMs: 250 });
      const active = new Map<string, number>();
      let maxPerItem = 0;
      let maxOverall = 0;
      await jobs.start({
        runItem: async (data) => {
          active.set(data.itemGid, (active.get(data.itemGid) ?? 0) + 1);
          maxPerItem = Math.max(maxPerItem, ...active.values());
          maxOverall = Math.max(maxOverall, [...active.values()].reduce((a, b) => a + b, 0));
          try {
            await runPushItem({ pool, adapter, shopify: fake.shopify, env: { pushMode: "dry_run", maxDecrease: 10 } }, data);
          } finally {
            active.set(data.itemGid, active.get(data.itemGid)! - 1);
          }
        },
        onFinalFailure: async (data, error) => failPushItem(pool, data, error),
      });
      const deps = { adapter, env: live, enqueue: jobs.enqueueItemOnClient };
      await createPush(pool, deps, { key: "order-key-01", request: req(), staffId: null }); // A + B
      await sleep(100); // first jobs are active now
      await createPush(pool, deps, { key: "order-key-02", request: req({ skus: ["SKU-A"], all: false }), staffId: null }); // A again (queued behind)
      for (let i = 0; i < 60; i++) {
        const done = await pool.query("select count(*)::int as c from warehouse_pushes where status = 'done'");
        if (done.rows[0].c === 2) break;
        await sleep(250);
      }
      const { rows } = await pool.query("select status from warehouse_pushes order by id");
      expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
      expect(maxPerItem).toBe(1);
      expect(maxOverall).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });

  it("mutation text: on_hand, changeFromQuantity and @idempotent — never compareQuantity", () => {
    expect(SET_ON_HAND_MUTATION).toContain("@idempotent(key: $idempotencyKey)");
    expect(SET_ON_HAND_MUTATION).toContain("userErrors { code field message }");
    expect(SET_ON_HAND_MUTATION).not.toMatch(/compareQuantity|ignoreCompareQuantity/);
  });
});
