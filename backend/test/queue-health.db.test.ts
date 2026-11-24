// Real Postgres + pg-boss in a throwaway database. Skipped unless DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { queueHealth } from "../src/db/queue-health.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("queue health (pg-boss)", () => {
  const dbName = `queue_health_${randomUUID().slice(0, 8)}`;
  const root = new pg.Pool({ connectionString: url, max: 1 });
  const testUrl = (() => {
    const u = new URL(url ?? "postgres://x/y");
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const pool = new pg.Pool({ connectionString: testUrl });
  pool.on("error", () => {});
  root.on("error", () => {});
  let boss: PgBoss;

  beforeAll(async () => {
    await root.query(`create database ${dbName}`);
    await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  });
  afterAll(async () => {
    await boss?.stop({ graceful: true, timeout: 5000 }).catch(() => {});
    await pool.end();
    await root.query(`drop database if exists ${dbName} with (force)`);
    await root.end();
  });

  it("is empty before pg-boss creates its schema", async () => {
    expect(await queueHealth(pool)).toEqual([]);
  });

  it("counts queued jobs per queue and ages the oldest due one (deferred jobs don't count as old)", async () => {
    boss = new PgBoss({ connectionString: testUrl, max: 2 });
    boss.on("error", () => {});
    await boss.start();
    await boss.createQueue("test-queue");
    await boss.createQueue("empty-queue");
    await boss.send("test-queue", { n: 1 });
    await boss.send("test-queue", { n: 2 }, { startAfter: 3600 }); // due in an hour
    await pool.query(`update pgboss.job set start_after = now() - interval '20 minutes' where name = 'test-queue' and data->>'n' = '1'`);

    const queues = await queueHealth(pool);
    const test = queues.find((q) => q.name === "test-queue")!;
    expect(test).toMatchObject({ queued: 2, active: 0, failed: 0 });
    expect(test.oldestQueuedSeconds).toBeGreaterThanOrEqual(20 * 60);
    expect(test.oldestQueuedSeconds).toBeLessThan(21 * 60);
    expect(queues.some((q) => q.name.startsWith("__pgboss__"))).toBe(false);
    expect(queues.find((q) => q.name === "empty-queue")).toEqual({ name: "empty-queue", queued: 0, active: 0, failed: 0, oldestQueuedSeconds: null });

    const db = createDb(testUrl);
    const details = await db.healthDetails();
    expect(details.queues?.map((q) => q.name)).toEqual(expect.arrayContaining(["test-queue", "empty-queue"]));
    expect(details.warehouseDifferences).toBeNull();
    await db.close();
  });
});
