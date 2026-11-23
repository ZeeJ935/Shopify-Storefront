/**
 * Idempotent Admin API webhook subscription sync.
 *
 *   npm run webhooks:register
 *   npm run webhooks:register -- --dry-run
 *
 * Requires BACKEND_PUBLIC_URL + Admin client credentials + SHOPIFY_STORE_DOMAIN.
 */
import { readEnv } from "../env.js";
import { createShopifyAdmin, type ShopifyAdmin } from "../shopify-admin/index.js";
import { ShopifyUserErrors } from "../shopify-admin/client.js";
import { APP_REGISTER_TOPICS, normalizeSubscriptionTopic, topicToGraphqlEnum } from "./register-topics.js";

export type TopicResult =
  | { topic: string; status: "created" | "updated" | "skipped" | "would_create" | "would_update" }
  | { topic: string; status: "failed"; error: string };

type ExistingSub = { id: string; topic: string; uri: string };

const LIST_QUERY = `query WebhookSubs($cursor: String) {
  webhookSubscriptions(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id topic uri }
  }
}`;

const CREATE_MUTATION = `mutation WebhookSubCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

const UPDATE_MUTATION = `mutation WebhookSubUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

type SubscriptionListData = {
  webhookSubscriptions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { id: string; topic: string; uri: string }[];
  };
};

export async function listHttpSubscriptions(admin: ShopifyAdmin): Promise<ExistingSub[]> {
  const out: ExistingSub[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: SubscriptionListData = await admin.request<SubscriptionListData>(LIST_QUERY, { cursor });
    for (const node of data.webhookSubscriptions.nodes) {
      if (typeof node.uri === "string" && node.uri.startsWith("http")) {
        out.push({ id: node.id, topic: normalizeSubscriptionTopic(node.topic), uri: node.uri });
      }
    }
    if (!data.webhookSubscriptions.pageInfo.hasNextPage) break;
    cursor = data.webhookSubscriptions.pageInfo.endCursor;
  }
  return out;
}

function failMessage(error: unknown): string {
  if (error instanceof ShopifyUserErrors) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function sameUri(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export async function syncWebhookSubscriptions({
  admin,
  callbackUrl,
  topics = [...APP_REGISTER_TOPICS],
  dryRun = false,
  log = console.log,
}: {
  admin: ShopifyAdmin;
  callbackUrl: string;
  topics?: string[];
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<TopicResult[]> {
  const existing = await listHttpSubscriptions(admin);
  const byTopic = new Map(existing.map((s) => [s.topic, s]));
  const results: TopicResult[] = [];

  for (const topic of topics) {
    const current = byTopic.get(topic);
    try {
      if (!current) {
        if (dryRun) {
          results.push({ topic, status: "would_create" });
          log(`${topic}: would_create → ${callbackUrl}`);
          continue;
        }
        await admin.request(CREATE_MUTATION, {
          topic: topicToGraphqlEnum(topic),
          webhookSubscription: { uri: callbackUrl },
        });
        results.push({ topic, status: "created" });
        log(`${topic}: created → ${callbackUrl}`);
        continue;
      }

      if (sameUri(current.uri, callbackUrl)) {
        results.push({ topic, status: "skipped" });
        log(`${topic}: skipped (already ${current.uri})`);
        continue;
      }

      if (dryRun) {
        results.push({ topic, status: "would_update" });
        log(`${topic}: would_update ${current.uri} → ${callbackUrl}`);
        continue;
      }

      await admin.request(UPDATE_MUTATION, {
        id: current.id,
        webhookSubscription: { uri: callbackUrl },
      });
      results.push({ topic, status: "updated" });
      log(`${topic}: updated → ${callbackUrl}`);
    } catch (error) {
      const message = failMessage(error);
      results.push({ topic, status: "failed", error: message });
      log(`${topic}: failed — ${message}`);
    }
  }

  return results;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = readEnv();
  if (!env.backendPublicUrl) throw new Error("BACKEND_PUBLIC_URL is required for webhooks:register.");
  if (!env.shopifyStoreDomain || !env.shopifyAdminClientId || !env.shopifyAdminClientSecret) {
    throw new Error("SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_CLIENT_ID and SHOPIFY_ADMIN_CLIENT_SECRET are required.");
  }

  const callbackUrl = `${env.backendPublicUrl}/webhooks/shopify`;
  const admin = createShopifyAdmin({
    storeDomain: env.shopifyStoreDomain,
    clientId: env.shopifyAdminClientId,
    clientSecret: env.shopifyAdminClientSecret,
    apiVersion: env.shopifyAdminApiVersion,
  });

  console.log(dryRun ? "Dry run — no changes will be made." : "Registering app webhook subscriptions…");
  console.log(`Callback: ${callbackUrl}`);
  const results = await syncWebhookSubscriptions({ admin, callbackUrl, dryRun });
  const failed = results.filter((r) => r.status === "failed");
  console.log(`Done: ${results.length - failed.length} ok, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}

const entry = process.argv[1] ?? "";
if (entry.includes("webhooks/register") || entry.endsWith("register.ts") || entry.endsWith("register.js")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
