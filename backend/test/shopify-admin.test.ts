import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createShopifyAdmin, ShopifyUserErrors } from "../src/shopify-admin/index.js";
import { createTokenCache, TOKEN_REFRESH_SKEW_MS } from "../src/shopify-admin/token.js";

const CLIENT_ID = "admin-client-id";
const CLIENT_SECRET = "admin-client-secret-VALUE-never-leak";
const ACCESS_TOKEN = "shpua_ACCESS_TOKEN_never_in_logs_or_errors";
const ACCESS_TOKEN_2 = "shpua_ACCESS_TOKEN_refreshed_second";

async function listenFake(handlers: {
  onToken?: (body: URLSearchParams) => { status: number; json: unknown };
  onGraphql?: (opts: { token?: string; body: unknown; n: number }) => { status: number; json: unknown };
}) {
  let tokenPosts = 0;
  let graphqlPosts = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = req.url ?? "";

    if (req.method === "POST" && url === "/admin/oauth/access_token") {
      tokenPosts++;
      const params = new URLSearchParams(raw);
      const reply = handlers.onToken?.(params) ?? {
        status: 200,
        json: { access_token: ACCESS_TOKEN, scope: "read_products", expires_in: 3600 },
      };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.json));
      return;
    }

    if (req.method === "POST" && url.startsWith("/admin/api/") && url.endsWith("/graphql.json")) {
      graphqlPosts++;
      const token = typeof req.headers["x-shopify-access-token"] === "string" ? req.headers["x-shopify-access-token"] : undefined;
      const body = raw ? JSON.parse(raw) : {};
      const reply = handlers.onGraphql?.({ token, body, n: graphqlPosts }) ?? {
        status: 200,
        json: {
          data: { shop: { name: "ZJ Test Shop" } },
          extensions: {
            cost: { requestedQueryCost: 1, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 999, restoreRate: 50 } },
          },
        },
      };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.json));
      return;
    }

    res.writeHead(404).end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP address");
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    get tokenPosts() {
      return tokenPosts;
    },
    get graphqlPosts() {
      return graphqlPosts;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

let fake: Awaited<ReturnType<typeof listenFake>> | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe("Shopify Admin token cache", () => {
  it("uses expires_in from the response and caches until near expiry", async () => {
    let now = 1_000_000;
    let issued = 0;
    fake = await listenFake({
      onToken: () => {
        issued++;
        return {
          status: 200,
          json: {
            access_token: issued === 1 ? ACCESS_TOKEN : ACCESS_TOKEN_2,
            expires_in: 120,
            scope: "read_products",
          },
        };
      },
    });

    const tokens = createTokenCache({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      now: () => now,
    });

    expect(await tokens.getAccessToken()).toBe(ACCESS_TOKEN);
    expect(await tokens.getAccessToken()).toBe(ACCESS_TOKEN);
    expect(fake.tokenPosts).toBe(1);

    now += 120_000 - TOKEN_REFRESH_SKEW_MS + 1;
    expect(await tokens.getAccessToken()).toBe(ACCESS_TOKEN_2);
    expect(fake.tokenPosts).toBe(2);
  });

  it("does not put the client secret in the error when the token request fails", async () => {
    fake = await listenFake({
      onToken: () => ({ status: 401, json: { error: "invalid_client", error_description: CLIENT_SECRET } }),
    });

    const tokens = createTokenCache({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
    });

    try {
      await tokens.getAccessToken();
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/token request failed: 401/);
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).not.toContain(CLIENT_ID);
    }
  });
});

describe("Shopify Admin GraphQL client", () => {
  it("fetches a token once for two GraphQL calls", async () => {
    fake = await listenFake({});
    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
    });

    const a = await admin.request<{ shop: { name: string } }>(`{ shop { name } }`);
    const b = await admin.request<{ shop: { name: string } }>(`{ shop { name } }`);
    expect(a.shop.name).toBe("ZJ Test Shop");
    expect(b.shop.name).toBe("ZJ Test Shop");
    expect(fake.tokenPosts).toBe(1);
    expect(fake.graphqlPosts).toBe(2);
  });

  it("waits when the throttle bucket is low", async () => {
    const sleeps: number[] = [];
    fake = await listenFake({
      onGraphql: ({ n }) => ({
        status: 200,
        json: {
          data: { shop: { name: n === 1 ? "Low" : "Ok" } },
          extensions: {
            cost: {
              requestedQueryCost: 10,
              throttleStatus: {
                maximumAvailable: 1000,
                currentlyAvailable: n === 1 ? 10 : 900,
                restoreRate: 50,
              },
            },
          },
        },
      }),
    });

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await admin.request(`{ shop { name } }`);
    await admin.request(`{ shop { name } }`);
    expect(sleeps.some((ms) => ms > 0)).toBe(true);
  });

  it("refreshes the token once on 401 and retries", async () => {
    let tokenN = 0;
    fake = await listenFake({
      onToken: () => {
        tokenN++;
        return {
          status: 200,
          json: {
            access_token: tokenN === 1 ? ACCESS_TOKEN : ACCESS_TOKEN_2,
            expires_in: 3600,
            scope: "read_products",
          },
        };
      },
      onGraphql: ({ token, n }) => {
        if (n === 1) {
          expect(token).toBe(ACCESS_TOKEN);
          return { status: 401, json: { errors: [{ message: "Unauthorized" }] } };
        }
        expect(token).toBe(ACCESS_TOKEN_2);
        return {
          status: 200,
          json: {
            data: { shop: { name: "Recovered" } },
            extensions: { cost: { throttleStatus: { currentlyAvailable: 900, restoreRate: 50 } } },
          },
        };
      },
    });

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      sleep: async () => {},
    });

    const data = await admin.request<{ shop: { name: string } }>(`{ shop { name } }`);
    expect(data.shop.name).toBe("Recovered");
    expect(fake.tokenPosts).toBe(2);
    expect(fake.graphqlPosts).toBe(2);
  });

  it("retries 429 and 5xx with backoff", async () => {
    const sleeps: number[] = [];
    fake = await listenFake({
      onGraphql: ({ n }) => {
        if (n === 1) return { status: 429, json: { errors: [{ message: "Throttled" }] } };
        if (n === 2) return { status: 503, json: { errors: [{ message: "Unavailable" }] } };
        return {
          status: 200,
          json: {
            data: { shop: { name: "Ok" } },
            extensions: { cost: { throttleStatus: { currentlyAvailable: 900, restoreRate: 50 } } },
          },
        };
      },
    });

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const data = await admin.request<{ shop: { name: string } }>(`{ shop { name } }`);
    expect(data.shop.name).toBe("Ok");
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(fake.graphqlPosts).toBe(3);
  });

  it("surfaces userErrors without leaking secrets", async () => {
    fake = await listenFake({
      onGraphql: () => ({
        status: 200,
        json: {
          data: {
            inventorySetQuantities: {
              userErrors: [{ field: ["quantities"], message: "Quantity cannot be negative" }],
            },
          },
        },
      }),
    });

    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
    });

    try {
      await admin.request(`mutation { inventorySetQuantities(input: {}) { userErrors { message } } }`);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ShopifyUserErrors);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("Quantity cannot be negative");
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).not.toContain(ACCESS_TOKEN);
    }
  });

  it("keeps access tokens and the client secret out of thrown errors", async () => {
    fake = await listenFake({
      onGraphql: () => ({ status: 400, json: { errors: [{ message: "bad" }] } }),
    });
    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      sleep: async () => {},
    });

    try {
      await admin.request(`{ shop { name } }`);
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).not.toContain(ACCESS_TOKEN);
    }
  });

  it("caches Admin health for 60s", async () => {
    let now = 0;
    fake = await listenFake({});
    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      now: () => now,
    });

    const first = await admin.checkHealth();
    expect(first).toEqual({ ok: true, shop: "ZJ Test Shop" });
    expect(await admin.checkHealth()).toEqual(first);
    expect(fake.graphqlPosts).toBe(1);

    now += 60_000;
    await admin.checkHealth();
    expect(fake.graphqlPosts).toBe(2);
  });
});

describe("Admin health warning shape", () => {
  it("returns ok:false with a warning when GraphQL fails", async () => {
    fake = await listenFake({
      onGraphql: () => ({ status: 503, json: {} }),
    });
    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      sleep: async () => {},
    });

    const result = await admin.checkHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning).toMatch(/503|Admin/i);
      expect(result.warning).not.toContain(CLIENT_SECRET);
      expect(result.warning).not.toContain(ACCESS_TOKEN);
    }
  });
});
