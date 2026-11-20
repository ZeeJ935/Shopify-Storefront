import { describe, expect, it } from "vitest";
import { processWebhookEvent } from "../src/webhooks/process.js";
import { fakeWebhooks } from "./fakes.js";

async function recorded(topic: string) {
  const f = fakeWebhooks();
  await f.intake({ webhookId: `wh-${topic}`, topic, shopDomain: "s", payload: {}, handled: true });
  return f;
}

/** Runs the event the way the queue would: retrying while it throws, up to 10 tries. */
async function runLikeQueue(id: number, deps: Parameters<typeof processWebhookEvent>[1]) {
  for (let i = 0; i < 10; i++) {
    try {
      return await processWebhookEvent(id, deps);
    } catch {
      // the queue would wait (backoff) and retry
    }
  }
  throw new Error("still throwing after 10 tries");
}

describe("processWebhookEvent", () => {
  it("clears the storefront cache for catalog topics", async () => {
    for (const topic of ["products/create", "products/update", "products/delete", "collections/update", "inventory_levels/update"]) {
      const f = await recorded(topic);
      let calls = 0;
      expect(await processWebhookEvent(1, { store: f.store, revalidate: async () => void calls++ })).toBe("processed");
      expect(calls, topic).toBe(1);
      expect(f.rows[0].processedAt).not.toBeNull();
    }
  });

  it("does not call the cache for other topics", async () => {
    const f = await recorded("customers/update");
    let calls = 0;
    expect(await processWebhookEvent(1, { store: f.store, revalidate: async () => void calls++ })).toBe("processed");
    expect(calls).toBe(0);
  });

  it("retries, then marks failed after 5 attempts and keeps the error", async () => {
    const f = await recorded("products/update");
    let calls = 0;
    const result = await runLikeQueue(1, {
      store: f.store,
      revalidate: async () => {
        calls++;
        throw new Error("revalidate returned 503");
      },
    });
    expect(result).toBe("failed");
    expect(calls).toBe(5);
    expect(f.rows[0]).toMatchObject({ attempts: 5, processedAt: null, lastError: "Error: revalidate returned 503" });
    expect(f.rows[0].failedAt).not.toBeNull();
    // A late redelivery does nothing.
    expect(await processWebhookEvent(1, { store: f.store, revalidate: async () => {} })).toBe("skipped");
  });

  it("succeeds on a later attempt and clears the error", async () => {
    const f = await recorded("products/update");
    let calls = 0;
    const result = await runLikeQueue(1, {
      store: f.store,
      revalidate: async () => {
        if (++calls < 3) throw new Error("timeout");
      },
    });
    expect(result).toBe("processed");
    expect(f.rows[0]).toMatchObject({ attempts: 3, lastError: null, failedAt: null });
    expect(f.rows[0].processedAt).not.toBeNull();
  });

  it("skips an event that was already processed", async () => {
    const f = await recorded("products/update");
    await processWebhookEvent(1, { store: f.store, revalidate: async () => {} });
    let calls = 0;
    expect(await processWebhookEvent(1, { store: f.store, revalidate: async () => void calls++ })).toBe("skipped");
    expect(calls).toBe(0);
    expect(f.rows[0].attempts).toBe(1);
  });
});
