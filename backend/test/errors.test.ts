import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { safeError } from "../src/errors.js";
import { fakeCustomers, fakeFavourites } from "./fakes.js";

const TOKEN = "t".repeat(48);
const CUSTOMER = "31300000000017";

/** Shaped like the real failure: Drizzle puts the SQL params in its message; the cause is the Postgres error. */
function drizzleError() {
  const pg = Object.assign(new Error('relation "customers" does not exist'), { code: "42P01" });
  const err = new Error(`Failed query: select "favourites_imported_at" from "customers" where "customer_id" = $1\nparams: ${CUSTOMER}`, { cause: pg });
  err.name = "DrizzleQueryError";
  return err;
}

describe("safeError", () => {
  it("keeps the type, code and database message but no query values", () => {
    expect(safeError(drizzleError())).toEqual({
      type: "DrizzleQueryError",
      code: "42P01",
      message: 'relation "customers" does not exist',
    });
    expect(safeError(new Error(`boom params: ${CUSTOMER}`)).message).toBe("boom");
    expect(safeError(undefined)).toEqual({ type: "Error", code: undefined, message: "unknown error" });
  });
});

describe("500 responses", () => {
  it("log the failure without the customer ID and return a generic error", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const favourites = fakeFavourites();
    favourites.list = async () => {
      throw drizzleError();
    };
    const app = buildApp({
      serviceToken: TOKEN,
      customers: fakeCustomers(),
      favourites,
      pingDb: async () => {},
      logger: { level: "info", stream },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/favourites",
      headers: { authorization: `Bearer ${TOKEN}`, "x-customer-id": CUSTOMER },
    });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error" });
    const log = lines.join("");
    expect(log).toContain('"code":"42P01"');
    expect(log).toContain("request failed");
    expect(log).not.toContain(CUSTOMER);
    expect(log).not.toContain(TOKEN);
  });

  it("leave 4xx validation errors as before", async () => {
    const app = buildApp({ serviceToken: TOKEN, customers: fakeCustomers(), favourites: fakeFavourites(), pingDb: async () => {} });
    const res = await app.inject({
      method: "PUT",
      url: "/v1/favourites",
      headers: { authorization: `Bearer ${TOKEN}`, "x-customer-id": CUSTOMER },
      payload: { ids: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FST_ERR_VALIDATION");
  });
});
