import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { isValidCustomerId, isValidServiceToken } from "../src/auth.js";
import { fakeCustomers, fakeFavourites } from "./fakes.js";

const TOKEN = "t".repeat(48);
const CUSTOMER = "10000000000001";

function setup({ dbUp = true } = {}) {
  const customers = fakeCustomers();
  const app = buildApp({
    serviceToken: TOKEN,
    customers,
    favourites: fakeFavourites(),
    pingDb: async () => {
      if (!dbUp) throw new Error("down");
    },
  });
  return { app, touched: customers.touched };
}

let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("service token check", () => {
  it("accepts only the exact bearer token", () => {
    expect(isValidServiceToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isValidServiceToken(undefined, TOKEN)).toBe(false);
    expect(isValidServiceToken(TOKEN, TOKEN)).toBe(false); // no "Bearer "
    expect(isValidServiceToken(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isValidServiceToken(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(isValidServiceToken("Bearer ", TOKEN)).toBe(false);
  });

  it("validates customer IDs", () => {
    expect(isValidCustomerId(CUSTOMER)).toBe(true);
    expect(isValidCustomerId("gid://shopify/Customer/1")).toBe(true);
    expect(isValidCustomerId("")).toBe(false);
    expect(isValidCustomerId("a b")).toBe(false);
    expect(isValidCustomerId("x".repeat(256))).toBe(false);
    expect(isValidCustomerId(["1", "2"])).toBe(false);
  });
});

describe("GET /v1/me", () => {
  it("rejects a missing token with 401", async () => {
    const s = setup();
    app = s.app;
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: { "x-customer-id": CUSTOMER } });
    expect(res.statusCode).toBe(401);
    expect(s.touched).toEqual([]);
  });

  it("rejects a wrong token with 401, before checking the customer header", async () => {
    const s = setup();
    app = s.app;
    const res = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer wrong" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a missing or invalid customer ID with 400", async () => {
    const s = setup();
    app = s.app;
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: auth })).statusCode).toBe(400);
    const bad = await app.inject({ method: "GET", url: "/v1/me", headers: { ...auth, "x-customer-id": "bad id;" } });
    expect(bad.statusCode).toBe(400);
    expect(s.touched).toEqual([]);
  });

  it("returns the customer for a valid token and ID", async () => {
    const s = setup();
    app = s.app;
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${TOKEN}`, "x-customer-id": CUSTOMER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ customerId: CUSTOMER, firstSeenAt: "2026-01-01T00:00:00.000Z" });
    expect(s.touched).toEqual([CUSTOMER]);
  });
});

describe("GET /health", () => {
  it("needs no token", async () => {
    app = setup().app;
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: "up" });
  });

  it("reports 503 when the database is down", async () => {
    app = setup({ dbUp: false }).app;
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: "down" });
  });
});
