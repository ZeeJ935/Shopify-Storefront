import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { verifyShopifyHmac } from "../src/shopify-hmac.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const SECRET = "whsec_test";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body, "utf8").digest("base64");

let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function setup({ withSecret = true } = {}) {
  const secret = withSecret ? SECRET : undefined;
  const webhooks = fakeWebhooks();
  app = buildApp({
    serviceToken: "t".repeat(48),
    customers: fakeCustomers(),
    favourites: fakeFavourites(),
    pingDb: async () => {},
    webhooks: { secret, intake: webhooks.intake },
  });
  return { app, webhooks };
}

function send(
  instance: NonNullable<typeof app>,
  { body = JSON.stringify({ id: 1, title: "Shoe" }), topic = "products/update", id = "wh-1", hmac }: { body?: string; topic?: string; id?: string | null; hmac?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-shopify-topic": topic,
    "x-shopify-shop-domain": "zj-store.myshopify.com",
  };
  if (id !== null) headers["x-shopify-webhook-id"] = id;
  if (hmac !== null) headers["x-shopify-hmac-sha256"] = hmac ?? sign(body);
  return instance.inject({ method: "POST", url: "/webhooks/shopify", headers, payload: body });
}

describe("verifyShopifyHmac", () => {
  it("accepts the right signature only", () => {
    const body = Buffer.from('{"a":1}');
    expect(verifyShopifyHmac(body, sign('{"a":1}'), SECRET)).toBe(true);
    expect(verifyShopifyHmac(body, sign('{"a":1}', "other"), SECRET)).toBe(false);
    expect(verifyShopifyHmac(body, sign('{"a":2}'), SECRET)).toBe(false);
    expect(verifyShopifyHmac(body, "short", SECRET)).toBe(false);
    expect(verifyShopifyHmac(body, undefined, SECRET)).toBe(false);
  });
});

describe("POST /webhooks/shopify", () => {
  it("rejects a bad signature with 401 and stores nothing", async () => {
    const { app, webhooks } = setup();
    const res = await send(app, { hmac: sign("something else") });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid_signature" });
    expect(webhooks.rows).toHaveLength(0);
  });

  it("rejects a missing signature with 401", async () => {
    const { app, webhooks } = setup();
    expect((await send(app, { hmac: null })).statusCode).toBe(401);
    expect(webhooks.rows).toHaveLength(0);
  });

  it("needs no service token, records the event and queues it", async () => {
    const { app, webhooks } = setup();
    const res = await send(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(webhooks.rows).toHaveLength(1);
    expect(webhooks.rows[0]).toMatchObject({ webhookId: "wh-1", topic: "products/update", payload: { id: 1, title: "Shoe" } });
    expect(webhooks.queued).toEqual([1]);
  });

  it("drops a duplicate webhook ID: 200, still one row and one job", async () => {
    const { app, webhooks } = setup();
    expect((await send(app)).json()).toEqual({ ok: true });
    const again = await send(app);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(webhooks.rows).toHaveLength(1);
    expect(webhooks.queued).toEqual([1]);
  });

  it("records other topics without their payload and does not queue them", async () => {
    const { app, webhooks } = setup();
    const res = await send(app, { topic: "customers/update", body: JSON.stringify({ email: "x@example.com" }) });
    expect(res.statusCode).toBe(200);
    expect(webhooks.rows[0]).toMatchObject({ topic: "customers/update", payload: null });
    expect(webhooks.rows[0].processedAt).not.toBeNull();
    expect(webhooks.queued).toEqual([]);
  });

  it("returns 400 for missing webhook headers or bad JSON (after the signature check)", async () => {
    const { app, webhooks } = setup();
    expect((await send(app, { id: null })).statusCode).toBe(400);
    expect((await send(app, { body: "{not json" })).statusCode).toBe(400);
    expect(webhooks.rows).toHaveLength(0);
  });

  it("returns 500 when the secret isn't configured, so Shopify retries later", async () => {
    const { app } = setup({ withSecret: false });
    expect((await send(app)).statusCode).toBe(500);
  });

  it("leaves JSON parsing normal for other routes", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/favourites",
      headers: { authorization: `Bearer ${"t".repeat(48)}`, "x-customer-id": "1" },
      payload: { ids: ["gid://shopify/Product/1"] },
    });
    expect(res.statusCode).toBe(200);
  });
});
