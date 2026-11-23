import type pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { checkQuantities, toCreateInput } from "../src/fulfillments/actions.js";
import { normalizeRequest } from "../src/routes/fulfillments.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const TOKEN = "service-token-" + "f".repeat(40);
const FO = "gid://shopify/FulfillmentOrder/1";
const LINE = (n: number) => `gid://shopify/FulfillmentOrderLineItem/${n}`;

function app(enqueue = true) {
  return buildApp({
    serviceToken: TOKEN,
    customers: fakeCustomers(),
    favourites: fakeFavourites(),
    webhooks: fakeWebhooks().deps,
    pingDb: async () => {},
    // Validation failures return before the pool is touched.
    fulfillments: { pool: {} as pg.Pool, enqueueOnClient: enqueue ? async () => {} : undefined },
    logger: false,
  });
}

const post = (a: ReturnType<typeof app>, payload: unknown, key: string | null = "key-12345678") =>
  a.inject({
    method: "POST",
    url: "/v1/fulfillments",
    headers: { authorization: `Bearer ${TOKEN}`, ...(key ? { "idempotency-key": key } : {}) },
    payload: payload as Record<string, unknown>,
  });

describe("POST /v1/fulfillments validation", () => {
  it("needs the service token", async () => {
    const a = app();
    const res = await a.inject({ method: "POST", url: "/v1/fulfillments", payload: { fulfillment_order_id: "1" } });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("requires a well-formed Idempotency-Key", async () => {
    const a = app();
    expect((await post(a, { fulfillment_order_id: "1" }, null)).json()).toEqual({ error: "invalid_idempotency_key" });
    expect((await post(a, { fulfillment_order_id: "1" }, "short")).statusCode).toBe(400);
    expect((await post(a, { fulfillment_order_id: "1" }, "has spaces in it")).statusCode).toBe(400);
    await a.close();
  });

  it("rejects unknown fields, bad quantities and bad ids", async () => {
    const a = app();
    expect((await post(a, { fulfillment_order_id: "1", destination: { address1: "x" } })).statusCode).toBe(400);
    expect((await post(a, { fulfillment_order_id: "1", lines: [{ id: "2", quantity: 0 }] })).statusCode).toBe(400);
    expect((await post(a, { fulfillment_order_id: "gid://shopify/Order/1" })).json()).toEqual({ error: "invalid_fulfillment_order_id" });
    expect(
      (await post(a, { fulfillment_order_id: "1", lines: [{ id: "2", quantity: 1 }, { id: LINE(2), quantity: 1 }] })).json(),
    ).toEqual({ error: "duplicate_line_id" });
    expect((await post(a, { fulfillment_order_id: "1", tracking: { url: "https://t.example/1" } })).json()).toEqual({
      error: "tracking_url_requires_number",
    });
    await a.close();
  });

  it("only accepts dry runs when Admin is not configured", async () => {
    const a = app(false);
    expect((await post(a, { fulfillment_order_id: "1" })).json()).toEqual({ error: "fulfillments_not_configured" });
    await a.close();
  });
});

describe("request normalization", () => {
  it("defaults notify_customer to false, sorts lines, and converts numeric ids", () => {
    const r = normalizeRequest({ fulfillment_order_id: "1", lines: [{ id: "9", quantity: 1 }, { id: "3", quantity: 2 }] });
    expect(r).toEqual({
      request: {
        fulfillmentOrderId: FO,
        lines: [
          { id: LINE(3), quantity: 2 },
          { id: LINE(9), quantity: 1 },
        ],
        tracking: null,
        notifyCustomer: false,
      },
    });
  });

  it("builds the fulfillmentCreate input; no lines means all remaining", () => {
    expect(toCreateInput({ fulfillmentOrderId: FO, lines: null, tracking: null, notifyCustomer: false })).toEqual({
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: FO }],
      notifyCustomer: false,
    });
    expect(
      toCreateInput({ fulfillmentOrderId: FO, lines: [{ id: LINE(1), quantity: 1 }], tracking: { number: "1Z" }, notifyCustomer: true }),
    ).toEqual({
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: FO, fulfillmentOrderLineItems: [{ id: LINE(1), quantity: 1 }] }],
      notifyCustomer: true,
      trackingInfo: { number: "1Z" },
    });
  });

  it("checks status and remaining quantities", () => {
    const fo = (status: string, remaining: [string, number][]) => ({ status, remaining: new Map(remaining) });
    expect(checkQuantities(null, null)).toBe("fulfillment_order_not_found");
    expect(checkQuantities(fo("CLOSED", [[LINE(1), 1]]), null)).toBe("fulfillment_order_not_open");
    expect(checkQuantities(fo("OPEN", [[LINE(1), 0]]), null)).toBe("nothing_to_fulfill");
    expect(checkQuantities(fo("OPEN", [[LINE(1), 1]]), [{ id: LINE(2), quantity: 1 }])).toBe("unknown_line");
    expect(checkQuantities(fo("OPEN", [[LINE(1), 1]]), [{ id: LINE(1), quantity: 2 }])).toBe("quantity_exceeds_remaining");
    expect(checkQuantities(fo("IN_PROGRESS", [[LINE(1), 2]]), [{ id: LINE(1), quantity: 2 }])).toBeNull();
  });
});
