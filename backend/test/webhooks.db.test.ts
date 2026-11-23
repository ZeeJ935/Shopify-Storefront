// Real Postgres + real pg-boss. Skipped unless DATABASE_URL is set (CI sets it; locally: docker compose up -d).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { createWebhookIntake, createWebhookStore } from "../src/db/webhooks.js";
import { createWebhookQueue } from "../src/queue.js";
import { processWebhookEvent } from "../src/webhooks/process.js";
import { buildWebhookRegistry } from "../src/webhooks/registry.js";

const url = process.env.DATABASE_URL;
const run = randomUUID().slice(0, 8);
const wid = (n: number) => `test-${run}-${n}`;

describe.skipIf(!url)("webhooks (Postgres + pg-boss)", () => {
  const db = createDb(url ?? "");
  // A queue of its own per run, with a 1 s backoff so retries are quick.
  const queue = createWebhookQueue(url ?? "", { name: `test-webhooks-${run}`, retryDelaySeconds: 1 });
  const intake = createWebhookIntake(db.pool, queue.enqueueOnClient);
  const store = createWebhookStore(db.pool);
  const jobs = async () =>
    Number((await db.pool.query("select count(*) from pgboss.job where name = $1", [queue.name])).rows[0].count);

  let failuresLeft = 0;
  let calls = 0;
  beforeAll(async () => {
    const router = buildWebhookRegistry({
      revalidate: async () => {
        calls++;
        if (failuresLeft > 0) {
          failuresLeft--;
          throw new Error("storefront down");
        }
      },
    });
    await queue.start(async (eventId) => processWebhookEvent(eventId, { store, router }));
  });

  /** Waits until a recorded webhook is processed (or 30 s pass); returns its row. */
  async function waitProcessed(webhookId: string) {
    let row: { attempts: number; processed_at: Date | null; last_error: string | null } | undefined;
    for (let i = 0; i < 60; i++) {
      row = (await db.pool.query("select attempts, processed_at, last_error from webhook_events where webhook_id = $1", [webhookId])).rows[0];
      if (row?.processed_at) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return row;
  }

  afterAll(async () => {
    await db.pool.query("delete from webhook_events where webhook_id like $1", [`test-${run}-%`]);
    await queue.deleteQueue().catch(() => {});
    await queue.stop();
    await db.close();
  });

  it("requeue (stuck recovery) queues one job per event within the singleton window", async () => {
    const { eventId } = await intake({ webhookId: wid(900), topic: "customers/update", shopDomain: "s", payload: null, handled: false });
    const before = await jobs();
    await queue.requeue(eventId!);
    await queue.requeue(eventId!);
    const { rows } = await db.pool.query("select count(*)::int as c from pgboss.job where name = $1 and data->>'eventId' = $2", [
      queue.name,
      String(eventId),
    ]);
    expect(rows[0].c).toBe(1);
    expect(await jobs()).toBe(before + 1);
  });

  it("stores and queues once; a duplicate webhook ID is dropped", async () => {
    const event = { webhookId: wid(1), topic: "customers/update", shopDomain: "s", payload: null, handled: false };
    expect((await intake(event)).duplicate).toBe(false);
    expect((await intake(event)).duplicate).toBe(true);
    const { rows } = await db.pool.query("select count(*) from webhook_events where webhook_id = $1", [wid(1)]);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("rolls the insert back when queueing fails, so Shopify's retry is not seen as a duplicate", async () => {
    const failing = createWebhookIntake(db.pool, async () => {
      throw new Error("queue down");
    });
    const event = { webhookId: wid(2), topic: "products/update", shopDomain: "s", payload: { id: 2 }, handled: true };
    await expect(failing(event)).rejects.toThrow("queue down");
    expect((await intake(event)).duplicate).toBe(false);
  });

  it("retries with backoff and finishes on the 3rd attempt", async () => {
    // Let the event from the previous test finish first, so it can't use up these failures.
    await waitProcessed(wid(2));
    failuresLeft = 2;
    calls = 0;
    const before = await jobs();
    await intake({ webhookId: wid(3), topic: "products/update", shopDomain: "s", payload: { id: 3 }, handled: true });
    expect(await jobs()).toBe(before + 1);

    const row = await waitProcessed(wid(3));
    expect(row?.processed_at).not.toBeNull();
    expect(row?.attempts).toBe(3);
    expect(row?.last_error).toBeNull();
    expect(calls).toBe(3);
  }, 40_000);
});
