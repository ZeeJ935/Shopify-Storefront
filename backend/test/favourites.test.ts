import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { fakeCustomers, fakeFavourites } from "./fakes.js";

const TOKEN = "t".repeat(48);
const CUSTOMER = "10000000000001";
const auth = { authorization: `Bearer ${TOKEN}`, "x-customer-id": CUSTOMER };
const pid = (n: number) => `gid://shopify/Product/${n}`;
const many = (count: number) => Array.from({ length: count }, (_, i) => pid(i + 1));

let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function setup() {
  const favourites = fakeFavourites();
  app = buildApp({ serviceToken: TOKEN, customers: fakeCustomers(), favourites, pingDb: async () => {} });
  return { app, favourites };
}

const routes = [
  { method: "GET", url: "/v1/favourites" },
  { method: "PUT", url: "/v1/favourites", payload: { ids: [pid(1)] } },
  { method: "POST", url: "/v1/favourites/import", payload: { ids: [pid(1)] } },
] as const;

describe("favourites auth", () => {
  for (const route of routes) {
    it(`${route.method} ${route.url}: 401 without token, 401 wrong token, 400 without customer`, async () => {
      const { app, favourites } = setup();
      const noToken = await app.inject({ ...route, headers: { "x-customer-id": CUSTOMER } });
      expect(noToken.statusCode).toBe(401);
      const wrong = await app.inject({ ...route, headers: { authorization: "Bearer nope", "x-customer-id": CUSTOMER } });
      expect(wrong.statusCode).toBe(401);
      const noCustomer = await app.inject({ ...route, headers: { authorization: `Bearer ${TOKEN}` } });
      expect(noCustomer.statusCode).toBe(400);
      expect(favourites.lists.size).toBe(0);
    });
  }
});

describe("PUT /v1/favourites", () => {
  it("accepts 200 favourites and rejects 201", async () => {
    const { app } = setup();
    const ok = await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: many(200) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ids).toHaveLength(200);

    const tooMany = await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: many(201) } });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toEqual({ error: "too_many_favourites", max: 200 });
  });

  it("collapses duplicates, keeps order, and counts the limit after de-duplicating", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/favourites",
      headers: auth,
      payload: { ids: [pid(3), pid(1), pid(3), pid(2), pid(1)] },
    });
    expect(res.json()).toEqual({ ids: [pid(3), pid(1), pid(2)] });

    const dupes = await app.inject({
      method: "PUT",
      url: "/v1/favourites",
      headers: auth,
      payload: { ids: [...many(200), ...many(200)] },
    });
    expect(dupes.statusCode).toBe(200);
  });

  it("rejects a bad body", async () => {
    const { app } = setup();
    for (const payload of [{}, { ids: "x" }, { ids: [1] }, { ids: ["bad id"] }, { ids: [], extra: 1 }]) {
      const res = await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("replaces the list; an emptied list stays imported", async () => {
    const { app } = setup();
    await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: [pid(1), pid(2)] } });
    await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: [pid(2), pid(3)] } });
    expect((await app.inject({ method: "GET", url: "/v1/favourites", headers: auth })).json()).toEqual({
      ids: [pid(2), pid(3)],
      imported: true,
    });

    await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: [] } });
    expect((await app.inject({ method: "GET", url: "/v1/favourites", headers: auth })).json()).toEqual({
      ids: [],
      imported: true,
    });
  });
});

describe("POST /v1/favourites/import", () => {
  it("imports once; a second import changes nothing", async () => {
    const { app } = setup();
    const before = await app.inject({ method: "GET", url: "/v1/favourites", headers: auth });
    expect(before.json()).toEqual({ ids: [], imported: false });

    const first = await app.inject({ method: "POST", url: "/v1/favourites/import", headers: auth, payload: { ids: [pid(1), pid(2), pid(1)] } });
    expect(first.json()).toEqual({ ids: [pid(1), pid(2)], imported: true });

    const second = await app.inject({ method: "POST", url: "/v1/favourites/import", headers: auth, payload: { ids: [pid(9)] } });
    expect(second.json()).toEqual({ ids: [pid(1), pid(2)], imported: false });
  });

  it("does not overwrite favourites saved before the import ran", async () => {
    const { app } = setup();
    await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: [pid(5)] } });
    const res = await app.inject({ method: "POST", url: "/v1/favourites/import", headers: auth, payload: { ids: [pid(1)] } });
    expect(res.json()).toEqual({ ids: [pid(5)], imported: false });
  });

  it("trims an oversized old list to 200 instead of failing", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/v1/favourites/import", headers: auth, payload: { ids: many(250) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ids).toEqual(many(200));
  });

  it("keeps customers separate", async () => {
    const { app } = setup();
    await app.inject({ method: "PUT", url: "/v1/favourites", headers: auth, payload: { ids: [pid(1)] } });
    const other = await app.inject({ method: "GET", url: "/v1/favourites", headers: { ...auth, "x-customer-id": "20000000000002" } });
    expect(other.json()).toEqual({ ids: [], imported: false });
  });
});
