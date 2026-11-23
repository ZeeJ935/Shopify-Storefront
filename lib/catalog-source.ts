import { cacheLife, cacheTag } from "next/cache";
import {
  getBackendCatalog,
  getBackendCatalogOverview,
  isBackendConfigured,
  type BackendCatalog,
  type BackendOverviewProduct,
} from "./backend";

import { withCatalogFallback } from "./catalog-fallback";
import {
  assembleResult,
  filtersToSearchParams,
  rawFromSnapshot,
  type CatalogQueryOptions,
  type CatalogQueryResult,
} from "./catalog-query";
import { getCatalogSnapshot } from "./catalog-snapshot";
import { CATALOG_TAG } from "./shopify";

type BackendOverview = Awaited<ReturnType<typeof getBackendCatalogOverview>>;

// The catalog comes from the backend's Postgres (GET /v1/catalog). If the
// backend isn't configured, is down, or hasn't synced anything yet, the old
// in-memory snapshot answers instead, so the site never shows an empty catalog.
// Backend responses are cached under the "catalog" tag, which the backend clears
// (via /api/revalidate) after every sync.

// Errors must not escape a "use cache" function: Next reports them as a render
// error even when the caller catches them. So failures come back as a value,
// cached for seconds only (the backend is tried again almost straight away),
// and are turned back into an exception outside the cache, where the fallback runs.
type Cached<T> = { ok: true; value: T } | { ok: false; error: string };

const failure = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof Error ? error.message.slice(0, 200) : "backend error",
});

function unwrap<T>(result: Cached<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function cachedBackendCatalog(params: string): Promise<Cached<BackendCatalog>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  try {
    const value = await getBackendCatalog(new URLSearchParams(params));
    cacheLife("minutes");
    return { ok: true, value };
  } catch (error) {
    cacheLife("seconds");
    return failure(error);
  }
}

async function cachedBackendOverview(): Promise<Cached<BackendOverview>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  try {
    const value = await getBackendCatalogOverview();
    cacheLife("minutes");
    return { ok: true, value };
  } catch (error) {
    cacheLife("seconds");
    return failure(error);
  }
}

export async function queryCatalog(options: CatalogQueryOptions): Promise<CatalogQueryResult> {
  const params = filtersToSearchParams(options.filters, options.sort, {
    scope: options.scope ?? null,
    page: String(Math.max(1, options.page ?? 1)),
  });
  const { value } = await withCatalogFallback({
    configured: isBackendConfigured(),
    label: "catalog",
    fromBackend: async () => unwrap(await cachedBackendCatalog(params.toString())),
    // TODO(remove after catalog migration verified): snapshot fallback.
    fromSnapshot: async () => rawFromSnapshot(await getCatalogSnapshot(), options),
  });
  return assembleResult(value, options);
}

export type CatalogListProduct = Pick<BackendOverviewProduct, "handle" | "vendor" | "createdAt" | "featuredImage" | "images">;

/** Every product (light fields, catalog order) for the nav's brand tiles and the sitemap. */
export async function getCatalogProductList(): Promise<CatalogListProduct[]> {
  const { value } = await withCatalogFallback<{ products: CatalogListProduct[] }>({
    configured: isBackendConfigured(),
    label: "overview",
    fromBackend: async () => unwrap(await cachedBackendOverview()),
    // TODO(remove after catalog migration verified): snapshot fallback.
    fromSnapshot: async () => ({ products: (await getCatalogSnapshot()).products }),
  });
  return value.products;
}
