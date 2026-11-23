import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { runSyncAttempt } from "../src/catalog/jobs.js";
import { createReporter } from "../src/report.js";
import { STALE_AFTER_MS, type HealthDetails } from "../src/routes/health.js";
import { scrubEvent, scrubText } from "../src/sentry-scrub.js";
import { processWebhookEvent } from "../src/webhooks/process.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const TOKEN = "service-token-" + "s".repeat(40);
const CUSTOMER = "31300000000017";
const WEBHOOK_SECRET = "whsec_test";

type Reported = { error: unknown; tags: Record<string, string> };

function setup({ details, dbUp = true, logLines }: { details?: () => Promise<HealthDetails>; dbUp?: boolean; logLines?: string[] } = {}) {
  const reported: Reported[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      logLines?.push(chunk.toString());
      done();
    },
  });
  const app = buildApp({
    serviceToken: TOKEN,
    customers: fakeCustomers(),
    favourites: fakeFavourites(),
    webhooks: { secret: WEBHOOK_SECRET, intake: fakeWebhooks().intake },
    pingDb: async () => {
      if (!dbUp) throw new Error("connect ECONNREFUSED");
    },
    healthDetails: details,
    report: (error, tags) => reported.push({ error, tags }),
    debugRoutes: true,
    logger: logLines ? { level: "info", stream } : false,
  });
  return { app, reported };
}

describe("GET /health", () => {
  it("reports db, last sync and failed webhooks", async () => {
    const lastSyncAt = new Date(Date.now() - 60 * 60 * 1000);
    const { app } = setup({ details: async () => ({ lastSyncAt, failedWebhooks24h: 3 }) });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      db: "up",
      catalog: { lastSyncAt: lastSyncAt.toISOString(), stale: false },
      webhooks: { failedLast24h: 3 },
    });
    await app.close();
  });

  it("flags a stale or missing sync as a warning, still 200", async () => {
    for (const lastSyncAt of [new Date(Date.now() - STALE_AFTER_MS - 60_000), null]) {
      const { app } = setup({ details: async () => ({ lastSyncAt, failedWebhooks24h: 0 }) });
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json().catalog.stale).toBe(true);
      await app.close();
    }
  });

  it("is 503 only when the database is down", async () => {
    let detailsCalled = false;
    const { app } = setup({
      dbUp: false,
      details: async () => {
        detailsCalled = true;
        return { lastSyncAt: null, failedWebhooks24h: 0 };
      },
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: "down" });
    expect(detailsCalled).toBe(false);
    await app.close();
  });

  it("stays 200 if the details query fails", async () => {
    const { app } = setup({
      details: async () => {
        throw new Error("timeout");
      },
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().webhooks.failedLast24h).toBeNull();
    await app.close();
  });

  it("reports an Admin API warning as a field, still 200", async () => {
    const lastSyncAt = new Date(Date.now() - 60 * 60 * 1000);
    const app = buildApp({
      serviceToken: TOKEN,
      customers: fakeCustomers(),
      favourites: fakeFavourites(),
      webhooks: { secret: WEBHOOK_SECRET, intake: fakeWebhooks().intake },
      pingDb: async () => {},
      healthDetails: async () => ({ lastSyncAt, failedWebhooks24h: 0 }),
      adminApiHealth: async () => ({ ok: false, warning: "Admin API returned 503" }),
      logger: false,
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().adminApi).toEqual({ ok: false, warning: "Admin API returned 503" });
    expect(res.json().ok).toBe(true);
    await app.close();
  });
});

describe("error reporting", () => {
  it("a failed sync job reports on its last attempt only, tagged with job and reason", async () => {
    const reported: Reported[] = [];
    const report = (error: unknown, tags: Record<string, string>) => reported.push({ error, tags });
    const run = async () => {
      throw new Error("Storefront API returned 502");
    };
    await expect(runSyncAttempt(run, { reason: "nightly", retryCount: 0 }, report)).rejects.toThrow("502");
    await expect(runSyncAttempt(run, { reason: "nightly", retryCount: 1 }, report)).rejects.toThrow("502");
    expect(reported).toHaveLength(0);
    await expect(runSyncAttempt(run, { reason: "nightly", retryCount: 2 }, report)).rejects.toThrow("502");
    expect(reported).toHaveLength(1);
    expect(reported[0].tags).toEqual({ kind: "job", job: "catalog-full-sync", reason: "nightly", attempt: "3" });
    // A successful run reports nothing.
    await runSyncAttempt(async () => {}, { reason: "manual", retryCount: 2 }, report);
    expect(reported).toHaveLength(1);
  });

  it("a webhook that fails its last retry is reported once, with its topic", async () => {
    const w = fakeWebhooks();
    await w.intake({ webhookId: "w1", topic: "products/update", shopDomain: "s", payload: { id: 1 }, handled: true });
    const final: { eventId: number; topic: string }[] = [];
    const deps = {
      store: w.store,
      revalidate: async () => {
        throw new Error("revalidate returned 503");
      },
      onFinalFailure: (event: { eventId: number; topic: string }) => final.push(event),
    };
    for (let i = 0; i < 4; i++) await expect(processWebhookEvent(1, deps)).rejects.toThrow();
    expect(final).toHaveLength(0);
    expect(await processWebhookEvent(1, deps)).toBe("failed");
    expect(final).toEqual([{ eventId: 1, topic: "products/update" }]);
  });

  it("a 500 is reported with its route; createReporter logs and captures", async () => {
    const { app, reported } = setup();
    const res = await app.inject({ method: "GET", url: "/v1/debug/sentry", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(500);
    expect(reported).toHaveLength(1);
    expect(reported[0].tags).toEqual({ kind: "request", route: "/v1/debug/sentry" });
    await app.close();

    const captured: Reported[] = [];
    const lines: object[] = [];
    createReporter({ capture: (error, tags) => captured.push({ error, tags }), log: (l) => lines.push(l) })(new Error("boom"), { kind: "job" });
    expect(captured).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", kind: "job", err: { message: "boom" } });
    // A failing capture never breaks the caller.
    expect(() => createReporter({ capture: () => { throw new Error("sentry down"); }, log: () => {} })(new Error("x"), {})).not.toThrow();
  });
});

describe("request logs", () => {
  it("one structured line per request, and secrets never appear", async () => {
    const lines: string[] = [];
    const { app } = setup({ logLines: lines });
    const payload = JSON.stringify({ id: 1, note: "PAYLOAD-SECRET-VALUE", email: "shopper@example.com" });
    const hmac = createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("base64");

    await app.inject({ method: "GET", url: `/v1/me?secret=QUERY-SECRET-VALUE`, headers: { authorization: `Bearer ${TOKEN}`, "x-customer-id": CUSTOMER } });
    await app.inject({
      method: "POST",
      url: "/webhooks/shopify",
      headers: { "content-type": "application/json", "x-shopify-hmac-sha256": hmac, "x-shopify-topic": "products/update", "x-shopify-webhook-id": "w-1" },
      payload,
    });
    await app.inject({ method: "GET", url: "/v1/debug/sentry", headers: { authorization: `Bearer ${TOKEN}`, cookie: "session=COOKIE-SECRET" } });
    await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer wrong-token-WRONG-SECRET" } });
    await app.close();

    const log = lines.join("");
    for (const secret of [TOKEN, CUSTOMER, hmac, "PAYLOAD-SECRET-VALUE", "shopper@example.com", "QUERY-SECRET-VALUE", "COOKIE-SECRET", "WRONG-SECRET", WEBHOOK_SECRET]) {
      expect(log, `log contains ${secret}`).not.toContain(secret);
    }

    const requests = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === "request");
    expect(requests.map((r) => [r.route, r.status])).toEqual([
      ["/v1/me", 200],
      ["/webhooks/shopify", 200],
      ["/v1/debug/sentry", 500],
      ["/v1/me", 401],
    ]);
    for (const r of requests) {
      expect(typeof r.reqId).toBe("string");
      expect(typeof r.durationMs).toBe("number");
      expect(r.method).toMatch(/GET|POST/);
      expect(r).not.toHaveProperty("url");
    }
  });
});

describe("Sentry scrubbing", () => {
  it("removes headers, cookies, bodies, query strings, user data and tokens", () => {
    const event = scrubEvent({
      message: `failed for shopper@example.com with Bearer ${TOKEN}`,
      user: { id: CUSTOMER, email: "shopper@example.com" },
      request: {
        url: "https://api.example/v1/catalog?q=secret&customer=1",
        query_string: "q=secret",
        cookies: { session: "abc" },
        data: '{"note":"PAYLOAD-SECRET-VALUE"}',
        headers: { authorization: `Bearer ${TOKEN}`, cookie: "session=abc", "x-customer-id": CUSTOMER, "x-shopify-hmac-sha256": "sig", "user-agent": "curl" },
      },
      exception: { values: [{ type: "Error", value: `token ${"a".repeat(40)} leaked` }] },
      breadcrumbs: [{ message: "GET", data: { url: "https://shop.example/api?token=abc", payload: { secret: 1 } } }],
      extra: { customerId: CUSTOMER, note: "contact shopper@example.com" },
    });
    const json = JSON.stringify(event);
    for (const secret of [TOKEN, CUSTOMER, "shopper@example.com", "PAYLOAD-SECRET-VALUE", "session=abc", "q=secret", "token=abc", "a".repeat(40)]) {
      expect(json, `event contains ${secret}`).not.toContain(secret);
    }
    expect(event.request.headers["user-agent"]).toBe("curl");
    expect(event.request.url).toBe("https://api.example/v1/catalog");
    expect(event).not.toHaveProperty("user");
    expect(scrubText("ok short words")).toBe("ok short words");
  });
});
