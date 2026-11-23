import type { CustomersRepo } from "../src/db/client.js";
import type { FavouritesRepo } from "../src/db/favourites.js";
import type { WebhookIntake, WebhookStore } from "../src/db/webhooks.js";

/** In-memory customers repo. */
export function fakeCustomers(): CustomersRepo & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    async touch(customerId) {
      touched.push(customerId);
      return { customerId, firstSeenAt: new Date("2026-01-01T00:00:00Z") };
    },
  };
}

/** In-memory favourites repo with the same rules as the Postgres one. */
export function fakeFavourites(): FavouritesRepo & { lists: Map<string, string[]>; importedSet: Set<string> } {
  const lists = new Map<string, string[]>();
  const importedSet = new Set<string>();
  const get = (id: string) => lists.get(id) ?? [];
  return {
    lists,
    importedSet,
    async list(customerId) {
      return { ids: get(customerId), imported: importedSet.has(customerId) };
    },
    async replace(customerId, ids) {
      // Existing favourites keep their place; new ones go to the end.
      const kept = get(customerId).filter((id) => ids.includes(id));
      const next = [...kept, ...ids.filter((id) => !kept.includes(id))];
      lists.set(customerId, next);
      importedSet.add(customerId);
      return next;
    },
    async importOnce(customerId, ids) {
      if (importedSet.has(customerId)) return { ids: get(customerId), imported: false };
      lists.set(customerId, [...new Set([...get(customerId), ...ids])]);
      importedSet.add(customerId);
      return { ids: get(customerId), imported: true };
    },
  };
}

/** In-memory webhook intake + store + queue, following the same rules as the Postgres ones. */
export function fakeWebhooks() {
  type Row = {
    id: number;
    webhookId: string;
    topic: string;
    payload: unknown;
    processedAt: Date | null;
    failedAt: Date | null;
    attempts: number;
    lastError: string | null;
  };
  const rows: Row[] = [];
  const queued: number[] = [];
  const intake: WebhookIntake = async (event) => {
    if (rows.some((r) => r.webhookId === event.webhookId)) return { duplicate: true };
    const row: Row = {
      id: rows.length + 1,
      webhookId: event.webhookId,
      topic: event.topic,
      payload: event.payload,
      processedAt: event.handled ? null : new Date(),
      failedAt: null,
      attempts: 0,
      lastError: null,
    };
    rows.push(row);
    if (event.handled) queued.push(row.id);
    return { duplicate: false, eventId: row.id };
  };
  const store: WebhookStore = {
    async beginAttempt(id) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.processedAt || row.failedAt) return null;
      row.attempts++;
      return { topic: row.topic, attempts: row.attempts, payload: row.payload };
    },
    async markProcessed(id) {
      const row = rows.find((r) => r.id === id)!;
      row.processedAt = new Date();
      row.lastError = null;
    },
    async markError(id, error, final) {
      const row = rows.find((r) => r.id === id)!;
      row.lastError = error;
      if (final) row.failedAt = new Date();
    },
  };
  return { rows, queued, intake, store, deps: { secret: "whsec_test", intake } };
}
