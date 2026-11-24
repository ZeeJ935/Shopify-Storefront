import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pushResultBadge, warehouseStatusBadge } from "../lib/badges";
import { createTicket, navFor, openTicket } from "../lib/fulfill";
import { openSealedTicket, sealTicket, TICKET_TTL_SECONDS } from "../lib/ticket";
import type { WarehouseDiffRow } from "../lib/types-warehouse";
import { buildPushBody, canEditStock, canPush, confirmRows } from "../lib/warehouse";

const row = (sku: string, status: WarehouseDiffRow["status"], onHand: number | null, warehouse: number): WarehouseDiffRow => ({
  sku,
  locationShopifyId: "gid://shopify/Location/1",
  locationName: "Main",
  inventoryItemShopifyId: "gid://shopify/InventoryItem/1",
  warehouseQuantity: warehouse,
  onHand,
  available: onHand,
  committed: 0,
  difference: onHand === null ? null : warehouse - onHand,
  status,
  stale: false,
  mirrorSyncedAt: null,
});
const rows = [row("A", "differs", 20, 25), row("B", "large_decrease", 20, 5), row("C", "match", 7, 7), row("D", "unknown_sku", null, 3)];
const form = (values: Record<string, string | string[]>) => ({
  get: (n: string) => (Array.isArray(values[n]) ? (values[n] as string[])[0] : (values[n] as string)) ?? null,
  getAll: (n: string) => (Array.isArray(values[n]) ? (values[n] as string[]) : values[n] ? [values[n] as string] : []),
});
const SECRET = "s".repeat(40);
const NOW = 1_800_000_000;

describe("warehouse push body", () => {
  it("selected rows: only pushable SKUs are kept; flags only when ticked", () => {
    assert.deepEqual(buildPushBody(form({ scope: "selected", sku: ["C", "A", "D", "A"] }), rows), { body: { skus: ["A"], allow_large_decrease: false, dry_run: false } });
    assert.deepEqual(buildPushBody(form({ scope: "all", dry_run: "on", allow_large_decrease: "on" }), rows), { body: { all: true, allow_large_decrease: true, dry_run: true } });
    assert.ok("error" in buildPushBody(form({ scope: "selected", sku: ["C"] }), rows));
    assert.ok("error" in buildPushBody(form({ scope: "all" }), [row("C", "match", 7, 7)]));
  });

  it("confirm rows show from → to and flag large decreases", () => {
    const without = confirmRows(rows, { all: true, allow_large_decrease: false, dry_run: false });
    assert.deepEqual(without.map((r) => [r.sku, r.from, r.to, r.largeDecrease, r.willApply]), [
      ["A", 20, 25, false, true],
      ["B", 20, 5, true, false],
    ]);
    assert.equal(confirmRows(rows, { all: true, allow_large_decrease: true, dry_run: false })[1].willApply, true);
    assert.deepEqual(confirmRows(rows, { skus: ["B"], allow_large_decrease: false, dry_run: false }).map((r) => r.sku), ["B"]);
  });
});

describe("sealed tickets", () => {
  it("one key per confirm screen; bound to kind, staff and expiry", () => {
    const body = { all: true, allow_large_decrease: false, dry_run: false };
    const t = sealTicket("warehouse-push", body, 3, SECRET, NOW);
    const a = openSealedTicket("warehouse-push", t, 3, SECRET, NOW + 1);
    const b = openSealedTicket("warehouse-push", t, 3, SECRET, NOW + 2);
    assert.ok(a && b && a.key === b.key); // double click → same key → backend replays
    assert.deepEqual(a!.body, body);
    assert.equal(openSealedTicket("fulfill", t, 3, SECRET, NOW), null); // can't reuse a push ticket to fulfill
    assert.equal(openSealedTicket("warehouse-push", t, 4, SECRET, NOW), null);
    assert.equal(openSealedTicket("warehouse-push", t, 3, SECRET, NOW + TICKET_TTL_SECONDS + 1), null);
    assert.equal(openSealedTicket("warehouse-push", t.slice(0, -2) + "xx", 3, SECRET, NOW), null);
  });

  it("fulfill tickets still work through the shared helper", () => {
    const body = { fulfillment_order_id: "gid://shopify/FulfillmentOrder/1", lines: [{ id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 1 }], notify_customer: false };
    const opened = openTicket(createTicket(body, 3, SECRET, NOW), 3, SECRET, NOW);
    assert.deepEqual(opened?.body, body);
    assert.equal(openSealedTicket("warehouse-push", createTicket(body, 3, SECRET, NOW), 3, SECRET, NOW), null);
  });
});

describe("roles and labels", () => {
  it("viewers see the page but get no push or stock actions", () => {
    assert.ok(navFor("viewer").some((n) => n.href === "/warehouse"));
    assert.equal(canPush("viewer"), false);
    assert.equal(canPush("operator"), true);
    assert.equal(canEditStock("operator"), false);
    assert.equal(canEditStock("admin"), true);
  });

  it("badges", () => {
    assert.equal(warehouseStatusBadge("large_decrease").tone, "critical");
    assert.equal(warehouseStatusBadge("match").label, "In sync");
    assert.equal(pushResultBadge("conflict_gave_up").tone, "critical");
    assert.equal(pushResultBadge("skipped_not_stocked").label, "Skipped: not stocked");
  });
});
