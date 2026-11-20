// Runs the real Postgres repo. Skipped unless DATABASE_URL is set (CI sets it; locally: docker compose up -d).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";

const url = process.env.DATABASE_URL;
const pid = (n: number) => `gid://shopify/Product/${n}`;

describe.skipIf(!url)("favourites repo (Postgres)", () => {
  const db = createDb(url ?? "");
  // A fresh customer per run, so the test never touches real rows.
  const customer = `test-${randomUUID()}`;

  afterAll(async () => {
    await db.pool.query("delete from customers where customer_id = $1", [customer]);
    await db.close();
  });

  it("imports once, in order, and a second import is a no-op", async () => {
    expect(await db.favourites.list(customer)).toEqual({ ids: [], imported: false });
    expect(await db.favourites.importOnce(customer, [pid(3), pid(1), pid(2)])).toEqual({
      ids: [pid(3), pid(1), pid(2)],
      imported: true,
    });
    expect(await db.favourites.importOnce(customer, [pid(9)])).toEqual({
      ids: [pid(3), pid(1), pid(2)],
      imported: false,
    });
  });

  it("replace keeps existing order, appends new ones, removes missing ones", async () => {
    expect(await db.favourites.replace(customer, [pid(2), pid(4), pid(3)])).toEqual([pid(3), pid(2), pid(4)]);
    expect(await db.favourites.replace(customer, [])).toEqual([]);
    expect(await db.favourites.list(customer)).toEqual({ ids: [], imported: true });
  });

  it("two imports at the same time import only once", async () => {
    const other = `test-${randomUUID()}`;
    try {
      const [a, b] = await Promise.all([
        db.favourites.importOnce(other, [pid(1)]),
        db.favourites.importOnce(other, [pid(2)]),
      ]);
      expect([a.imported, b.imported].sort()).toEqual([false, true]);
      expect((await db.favourites.list(other)).ids).toHaveLength(1);
    } finally {
      await db.pool.query("delete from customers where customer_id = $1", [other]);
    }
  });
});
