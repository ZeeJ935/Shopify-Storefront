import { describe, expect, it } from "vitest";
import { recoverStuckWebhooks, type StuckEvent } from "../src/webhooks/maintenance.js";

describe("recoverStuckWebhooks", () => {
  it("requeues events with attempts left; marks the rest failed and reports once each", async () => {
    const stuck: StuckEvent[] = [
      { id: 1, topic: "orders/updated", attempts: 0 },
      { id: 2, topic: "products/update", attempts: 3 },
      { id: 3, topic: "inventory_items/update", attempts: 5 },
    ];
    const requeued: number[] = [];
    const markedFailed: number[] = [];
    const reported: { error: unknown; tags: Record<string, string> }[] = [];
    const logs: string[] = [];

    const result = await recoverStuckWebhooks({
      store: {
        findStuck: async () => stuck,
        markStuckFailed: async (id) => {
          markedFailed.push(id);
        },
      },
      requeue: async (id) => {
        requeued.push(id);
      },
      report: (error, tags) => reported.push({ error, tags }),
      log: (line) => logs.push(JSON.stringify(line)),
    });

    expect(result).toEqual({ requeued: 2, failed: 1 });
    expect(requeued).toEqual([1, 2]);
    expect(markedFailed).toEqual([3]);
    expect(reported).toHaveLength(1);
    expect(reported[0].tags).toEqual({ kind: "webhook", topic: "inventory_items/update", event_id: "3", reason: "stuck" });
    // Log lines carry topic + id only.
    expect(logs.every((l) => !l.includes("payload"))).toBe(true);
  });

  it("does nothing when nothing is stuck", async () => {
    const result = await recoverStuckWebhooks({
      store: { findStuck: async () => [], markStuckFailed: async () => {} },
      requeue: async () => {
        throw new Error("should not requeue");
      },
    });
    expect(result).toEqual({ requeued: 0, failed: 0 });
  });
});
