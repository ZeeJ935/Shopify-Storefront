import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createShopifyAdmin } from "../src/shopify-admin/index.js";
import { syncWebhookSubscriptions } from "../src/webhooks/register.js";
import { APP_REGISTER_TOPICS, topicToGraphqlEnum } from "../src/webhooks/register-topics.js";

const CLIENT_ID = "id";
const CLIENT_SECRET = "secret";
const ACCESS = "shpua_token";
const CALLBACK = "https://api.example.com/webhooks/shopify";

type Sub = { id: string; topic: string; uri: string };

async function listenFake(state: { subs: Sub[]; creates: string[]; updates: { id: string; uri: string }[]; failTopics: Set<string> }) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = req.url ?? "";

    if (url === "/admin/oauth/access_token") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: ACCESS, expires_in: 3600 }));
      return;
    }

    if (url.includes("/graphql.json")) {
      const body = JSON.parse(raw) as { query: string; variables?: Record<string, unknown> };
      // Match mutations before the list query — "WebhookSubscriptionTopic" contains "WebhookSubs".
      if (body.query.includes("webhookSubscriptionCreate")) {
        const topicEnum = String(body.variables?.topic ?? "");
        const topic = APP_REGISTER_TOPICS.find((t) => topicToGraphqlEnum(t) === topicEnum) ?? topicEnum;
        const shouldFail = [...state.failTopics].some(
          (t) => t === topic || t === topicEnum || topicToGraphqlEnum(t) === topicEnum,
        );
        if (shouldFail) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: {
                webhookSubscriptionCreate: {
                  webhookSubscription: null,
                  userErrors: [{ field: ["topic"], message: "Protected customer data access required" }],
                },
              },
            }),
          );
          return;
        }
        const uri = (body.variables?.webhookSubscription as { uri: string }).uri;
        state.creates.push(topic);
        state.subs.push({ id: `gid://shopify/WebhookSubscription/${state.subs.length + 1}`, topic: topicEnum, uri });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "1" }, userErrors: [] } } }));
        return;
      }
      if (body.query.includes("webhookSubscriptionUpdate")) {
        const id = String(body.variables?.id);
        const uri = (body.variables?.webhookSubscription as { uri: string }).uri;
        state.updates.push({ id, uri });
        const row = state.subs.find((s) => s.id === id);
        if (row) row.uri = uri;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { webhookSubscriptionUpdate: { webhookSubscription: { id }, userErrors: [] } } }));
        return;
      }
      if (body.query.includes("webhookSubscriptions(")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              webhookSubscriptions: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: state.subs,
              },
            },
          }),
        );
        return;
      }
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bad addr");
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

let fake: Awaited<ReturnType<typeof listenFake>> | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe("syncWebhookSubscriptions", () => {
  it("dry-run would_create, then create, then skip; updates changed URIs; continues after a failure", async () => {
    const state = {
      subs: [] as Sub[],
      creates: [] as string[],
      updates: [] as { id: string; uri: string }[],
      failTopics: new Set<string>(["orders/create"]),
    };
    fake = await listenFake(state);
    const admin = createShopifyAdmin({
      storeDomain: "test.myshopify.com",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      origin: fake.origin,
      sleep: async () => {},
    });

    const topics = ["inventory_items/update", "orders/create", "locations/create"];
    const lines: string[] = [];
    const dry = await syncWebhookSubscriptions({
      admin,
      callbackUrl: CALLBACK,
      topics,
      dryRun: true,
      log: (l) => lines.push(l),
    });
    expect(dry.map((r) => r.status)).toEqual(["would_create", "would_create", "would_create"]);
    expect(state.creates).toEqual([]);

    const first = await syncWebhookSubscriptions({
      admin,
      callbackUrl: CALLBACK,
      topics,
      log: (l) => lines.push(l),
    });
    expect(first.find((r) => r.topic === "inventory_items/update")?.status).toBe("created");
    expect(first.find((r) => r.topic === "locations/create")?.status).toBe("created");
    expect(first.find((r) => r.topic === "orders/create")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Protected customer data"),
    });
    expect(state.creates).toContain("inventory_items/update");
    expect(state.creates).toContain("locations/create");
    expect(state.creates).not.toContain("orders/create");

    // Seed an existing sub with a different URI for locations.
    state.subs = [
      { id: "gid://shopify/WebhookSubscription/1", topic: "INVENTORY_ITEMS_UPDATE", uri: CALLBACK },
      { id: "gid://shopify/WebhookSubscription/2", topic: "LOCATIONS_CREATE", uri: "https://old.example.com/webhooks/shopify" },
    ];
    state.creates = [];
    const second = await syncWebhookSubscriptions({
      admin,
      callbackUrl: CALLBACK,
      topics: ["inventory_items/update", "locations/create"],
      log: (l) => lines.push(l),
    });
    expect(second.find((r) => r.topic === "inventory_items/update")?.status).toBe("skipped");
    expect(second.find((r) => r.topic === "locations/create")?.status).toBe("updated");
    expect(state.updates).toEqual([{ id: "gid://shopify/WebhookSubscription/2", uri: CALLBACK }]);

    // Catalog topics must not be in the default register list.
    expect(APP_REGISTER_TOPICS).not.toContain("products/update");
    expect(APP_REGISTER_TOPICS).not.toContain("inventory_levels/update");
    expect(APP_REGISTER_TOPICS).toContain("fulfillments/create");
  });
});
