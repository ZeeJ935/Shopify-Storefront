import { errorText, type WebhookStore } from "../db/webhooks.js";
import { CATALOG_TOPICS, MAX_ATTEMPTS } from "./topics.js";

export type ProcessDeps = {
  store: WebhookStore;
  /** Tells Next.js to clear its catalog cache. Throws when that fails. */
  revalidate: () => Promise<void>;
  /** Updates the Postgres catalog for a catalog topic (absent when the catalog isn't configured). */
  catalog?: (topic: string, payload: unknown) => Promise<void>;
  maxAttempts?: number;
};

export type ProcessResult = "processed" | "skipped" | "retrying" | "failed";

/**
 * Processes one recorded webhook. Throws on failure so the queue retries it;
 * after the last allowed attempt the event is marked failed and the error kept.
 */
export async function processWebhookEvent(id: number, deps: ProcessDeps): Promise<ProcessResult> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  const event = await deps.store.beginAttempt(id);
  if (!event) return "skipped"; // already processed or failed (for example a redelivered job)

  try {
    if (CATALOG_TOPICS.has(event.topic)) {
      // Update our catalog first, then clear the storefront cache so it reads the new data.
      if (deps.catalog) await deps.catalog(event.topic, event.payload);
      await deps.revalidate();
    }
    await deps.store.markProcessed(id);
    return "processed";
  } catch (error) {
    const final = event.attempts >= max;
    await deps.store.markError(id, errorText(error), final);
    if (final) return "failed"; // keep the error; stop retrying
    throw error;
  }
}

/** POSTs {storefrontUrl}/api/revalidate with the shared service token. */
export function createRevalidator(storefrontUrl: string | undefined, token: string, timeoutMs = 10_000) {
  return async () => {
    if (!storefrontUrl) throw new Error("STOREFRONT_URL is not set");
    const response = await fetch(storefrontUrl.replace(/\/+$/, "") + "/api/revalidate", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`revalidate returned ${response.status}`);
  };
}
