import type { AdminClient } from "./client.js";

export type AdminApiHealth =
  | { ok: true; shop: string }
  | { ok: false; warning: string };

const SHOP_QUERY = `query AdminHealth { shop { name } }`;

export type AdminHealthChecker = {
  check: () => Promise<AdminApiHealth>;
};

/**
 * Cheap Admin reachability probe for /health. Cached for 60s (success and failure).
 * Failures are returned as a warning shape; they never throw.
 */
export function createAdminHealthCheck(
  client: AdminClient,
  {
    cacheMs = 60_000,
    now = Date.now,
  }: { cacheMs?: number; now?: () => number } = {},
): AdminHealthChecker {
  let cached: { at: number; result: AdminApiHealth } | null = null;

  return {
    async check() {
      if (cached && now() - cached.at < cacheMs) return cached.result;

      let result: AdminApiHealth;
      try {
        const data = await client.request<{ shop: { name: string } }>(SHOP_QUERY);
        const name = data.shop?.name;
        result = typeof name === "string" && name ? { ok: true, shop: name } : { ok: false, warning: "shop name missing" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Admin API unreachable";
        result = { ok: false, warning: message.slice(0, 200) };
      }

      cached = { at: now(), result };
      return result;
    },
  };
}
