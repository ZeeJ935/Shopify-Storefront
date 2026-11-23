import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionBadge, auditBadge, fulfillmentBadge, fulfillmentOrderBadge, paymentBadge, stockBadge } from "../lib/badges";

describe("status badges", () => {
  it("follow Shopify admin conventions", () => {
    assert.deepEqual(fulfillmentBadge("UNFULFILLED"), { tone: "attention", label: "Unfulfilled", dot: "empty" });
    assert.equal(fulfillmentBadge("FULFILLED").dot, "full");
    assert.equal(fulfillmentBadge("PARTIALLY_FULFILLED").tone, "warning");
    assert.equal(paymentBadge("PAID").label, "Paid");
    assert.equal(paymentBadge("PENDING").tone, "warning");
    assert.equal(fulfillmentOrderBadge("CLOSED").label, "Fulfilled");
    assert.equal(actionBadge("failed").tone, "critical");
    assert.equal(actionBadge("submitting").label, "Submitting");
    assert.equal(auditBadge("denied").tone, "critical");
    assert.equal(paymentBadge("SOMETHING_NEW").label, "Something new");
  });

  it("stock levels: out ≤ 0, low ≤ 5, else in stock", () => {
    assert.equal(stockBadge(0).label, "Out of stock");
    assert.equal(stockBadge(-2).label, "Out of stock");
    assert.equal(stockBadge(5).label, "Low stock");
    assert.equal(stockBadge(6).label, "In stock");
  });
});
