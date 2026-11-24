import { describe, expect, it } from "vitest";
import { ShopifyUserErrors } from "../src/shopify-admin/index.js";
import { classify, PUSHABLE, STALE_AFTER_MS, type ShopifySide } from "../src/warehouse/diff.js";
import { readWarehouseEnv } from "../src/warehouse/env.js";

const LOC = "gid://shopify/Location/1";
const ITEM = "gid://shopify/InventoryItem/10";
const NOW = Date.UTC(2026, 10, 24, 12);
const side = (over: Partial<ShopifySide> = {}): ShopifySide => ({
  locations: new Map([[LOC, "Main"]]),
  itemsBySku: new Map([["SKU-1", [{ shopifyId: ITEM, tracked: true }]]]),
  levels: new Map([[`${ITEM}|${LOC}`, { onHand: 20, available: 17, committed: 3, syncedAt: new Date(NOW - 60_000) }]]),
  ...over,
});
const stock = (quantity: number, sku = "SKU-1", loc = LOC) => ({ sku, locationShopifyId: loc, quantity, updatedAt: new Date(NOW).toISOString() });
const opts = { maxDecrease: 10, now: NOW };

describe("warehouse diff (on_hand)", () => {
  it("compares the warehouse with Shopify on_hand, showing available and committed", () => {
    const row = classify(stock(25), side(), opts);
    expect(row).toMatchObject({ status: "differs", onHand: 20, available: 17, committed: 3, difference: 5, inventoryItemShopifyId: ITEM, locationName: "Main", stale: false });
    expect(classify(stock(20), side(), opts).status).toBe("match");
    expect(classify(stock(10), side(), opts).status).toBe("differs"); // −10 is within the threshold
    expect(classify(stock(9), side(), opts).status).toBe("large_decrease"); // −11
  });

  it("never maps unknown, ambiguous, untracked or unstocked rows", () => {
    expect(classify(stock(5, "SKU-1", "gid://shopify/Location/999"), side(), opts).status).toBe("unknown_location");
    expect(classify(stock(5, "NOPE"), side(), opts).status).toBe("unknown_sku");
    const two = side({ itemsBySku: new Map([["SKU-1", [{ shopifyId: ITEM, tracked: true }, { shopifyId: "gid://shopify/InventoryItem/11", tracked: true }]]]) });
    const ambiguous = classify(stock(5), two, opts);
    expect(ambiguous.status).toBe("ambiguous_sku");
    expect(ambiguous.inventoryItemShopifyId).toBeNull();
    expect(classify(stock(5), side({ itemsBySku: new Map([["SKU-1", [{ shopifyId: ITEM, tracked: false }]]]) }), opts).status).toBe("untracked");
    expect(classify(stock(5), side({ levels: new Map() }), opts).status).toBe("not_stocked");
    for (const s of ["unknown_location", "unknown_sku", "ambiguous_sku", "untracked", "not_stocked", "match"] as const) expect(PUSHABLE.has(s)).toBe(false);
  });

  it("flags a stale mirror", () => {
    const old = side({ levels: new Map([[`${ITEM}|${LOC}`, { onHand: 20, available: 20, committed: 0, syncedAt: new Date(NOW - STALE_AFTER_MS - 1) }]]) });
    expect(classify(stock(25), old, opts).stale).toBe(true);
  });
});

describe("warehouse env", () => {
  it("defaults to dry_run and 10; rejects bad values", () => {
    expect(readWarehouseEnv({})).toEqual({ pushMode: "dry_run", maxDecrease: 10 });
    expect(readWarehouseEnv({ WAREHOUSE_PUSH_MODE: "LIVE", WAREHOUSE_MAX_DECREASE: "0" })).toEqual({ pushMode: "live", maxDecrease: 0 });
    expect(() => readWarehouseEnv({ WAREHOUSE_PUSH_MODE: "yes" })).toThrow(/dry_run or live/);
    expect(() => readWarehouseEnv({ WAREHOUSE_MAX_DECREASE: "-1" })).toThrow();
  });
});

describe("ShopifyUserErrors", () => {
  it("keeps userError codes", () => {
    const e = new ShopifyUserErrors([{ message: "stale", code: "CHANGE_FROM_QUANTITY_STALE", field: ["input"] }, { message: "x" }]);
    expect(e.codes).toEqual(["CHANGE_FROM_QUANTITY_STALE"]);
  });
});
