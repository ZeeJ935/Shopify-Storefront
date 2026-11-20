/** Topics that change what the storefront shows, so its catalog cache must be cleared. */
export const CATALOG_TOPICS: ReadonlySet<string> = new Set([
  "products/create",
  "products/update",
  "products/delete",
  "collections/create",
  "collections/update",
  "collections/delete",
  // Keeps "Only N left" and sold-out labels fresh.
  "inventory_levels/update",
]);

/** Attempts per event, including the first: pg-boss retries 4 times. */
export const MAX_ATTEMPTS = 5;
