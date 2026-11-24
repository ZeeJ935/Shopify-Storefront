import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFulfillmentBody, canFulfill, createTicket, describeFailure, navFor, openTicket, TICKET_TTL_SECONDS } from "../lib/fulfill";

const FO = "gid://shopify/FulfillmentOrder/1";
const L1 = "gid://shopify/FulfillmentOrderLineItem/11";
const L2 = "gid://shopify/FulfillmentOrderLineItem/12";
const remaining = [
  { id: L1, remainingQuantity: 2 },
  { id: L2, remainingQuantity: 1 },
];
const form = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
const SECRET = "s".repeat(40);
const NOW = 1_800_000_000;

describe("fulfill form", () => {
  it("builds exact lines, leaves out zeros, and notify defaults to false", () => {
    const r = buildFulfillmentBody(form({ [`qty:${L1}`]: "2", [`qty:${L2}`]: "0" }), FO, remaining);
    assert.deepEqual(r, { body: { fulfillment_order_id: FO, lines: [{ id: L1, quantity: 2 }], notify_customer: false } });
  });

  it("notify is only true when the box was ticked", () => {
    const r = buildFulfillmentBody(form({ [`qty:${L1}`]: "1", notify_customer: "on" }), FO, remaining);
    assert.ok("body" in r && r.body.notify_customer === true);
    const r2 = buildFulfillmentBody(form({ [`qty:${L1}`]: "1", notify_customer: "true" }), FO, remaining);
    assert.ok("body" in r2 && r2.body.notify_customer === false);
  });

  it("rejects too many, non-numbers, nothing selected, and a tracking URL without a number", () => {
    assert.ok("error" in buildFulfillmentBody(form({ [`qty:${L2}`]: "2" }), FO, remaining));
    assert.ok("error" in buildFulfillmentBody(form({ [`qty:${L1}`]: "1.5" }), FO, remaining));
    assert.ok("error" in buildFulfillmentBody(form({ [`qty:${L1}`]: "0", [`qty:${L2}`]: "0" }), FO, remaining));
    assert.ok("error" in buildFulfillmentBody(form({ [`qty:${L1}`]: "1", tracking_url: "https://t.example/1" }), FO, remaining));
    // Lines the browser invents are ignored: only server-provided lines are read.
    const r = buildFulfillmentBody(form({ [`qty:${L1}`]: "1", "qty:gid://shopify/FulfillmentOrderLineItem/999": "5" }), FO, remaining);
    assert.ok("body" in r && r.body.lines.length === 1);
  });
});

describe("confirm ticket (one idempotency key per confirm screen)", () => {
  const body = { fulfillment_order_id: FO, lines: [{ id: L1, quantity: 1 }], notify_customer: false };

  it("keeps the same key and body on every submit of the same screen", () => {
    const ticket = createTicket(body, 7, SECRET, NOW);
    const a = openTicket(ticket, 7, SECRET, NOW + 1);
    const b = openTicket(ticket, 7, SECRET, NOW + 2);
    assert.ok(a && b);
    assert.equal(a.key, b.key); // a double click replays, never a second fulfillment
    assert.deepEqual(a.body, body);
    // A new confirm screen gets a new key.
    assert.notEqual(openTicket(createTicket(body, 7, SECRET, NOW), 7, SECRET, NOW)!.key, a.key);
  });

  it("can't be altered, reused by someone else, or used after it expires", () => {
    const ticket = createTicket(body, 7, SECRET, NOW);
    assert.equal(openTicket(ticket.slice(0, -3) + "abc", 7, SECRET, NOW), null);
    assert.equal(openTicket(ticket, 8, SECRET, NOW), null);
    assert.equal(openTicket(ticket, 7, "x".repeat(40), NOW), null);
    assert.equal(openTicket(ticket, 7, SECRET, NOW + TICKET_TTL_SECONDS + 1), null);
  });
});

describe("roles in the UI", () => {
  it("viewers get no fulfill or audit/sync; operators fulfill; admins see audit", () => {
    assert.equal(canFulfill("viewer"), false);
    assert.equal(canFulfill("operator"), true);
    assert.deepEqual(navFor("viewer").map((n) => n.href), ["/orders", "/inventory", "/warehouse"]);
    assert.deepEqual(navFor("operator").map((n) => n.href), ["/orders", "/inventory", "/warehouse"]);
    assert.deepEqual(navFor("admin").map((n) => n.href), ["/orders", "/inventory", "/warehouse", "/audit"]);
  });

  it("explains refusals without echoing backend bodies", () => {
    assert.match(describeFailure(503, { error: "audit_unavailable" }), /nothing was done/);
    assert.match(describeFailure(403, { error: "forbidden" }), /role/);
    assert.equal(describeFailure(400, { error: "<script>" }), "The request was refused.");
  });
});
