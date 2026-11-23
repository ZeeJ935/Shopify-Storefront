import { cacheLife, cacheTag } from "next/cache";
import {
  getBackendCatalog,
  getBackendCatalogOverview,
  isBackendConfigured,
  type BackendCatalog,
  type BackendOverviewProduct,
} from "./backend";
import {
  assembleResult,
  filtersToSearchParams,
  type CatalogQueryOptions,
  type CatalogQueryResult,
} from "./catalog-query";
import { CATALOG_TAG } from "./shopify";

type BackendOverview = Awaited<ReturnType<typeof getBackendCatalogOverview>>;

// The catalog comes from the backend's Postgres (GET /v1/catalog). Responses are
// cached under the "catalog" tag, which the backend clears (via /api/revalidate)
// after every sync. If the backend can't answer, catalog pages show an error
// state with a retry button (app/collections/error.tsx) rather than an empty or
// out-of-date catalog.

/** The catalog can't be loaded right now (backend off, down, or not synced yet). */
export class CatalogUnavailableError extends Error {
  constructor(reason: string) {
    super(`Catalog unavailable: ${reason}`);
    this.name = "CatalogUnavailableError";
  }
}

// Errors must not escape a "use cache" function: Next reports them as a render
// error even when the caller catches them. So failures come back as a value,
// cached for seconds only (the backend is tried again almost straight away),
// and are turned back into an exception outside the cache.
type Cached<T> = { ok: true; value: T } | { ok: false; error: string };

const failure = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof Error ? error.message.slice(0, 200) : "backend error",
});

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
  if (!isBackendConfigured()) throw new CatalogUnavailableError("BACKEND_URL / BACKEND_SERVICE_TOKEN not set");
  const params = filtersToSearchParams(options.filters, options.sort, {
    scope: options.scope ?? null,
    page: String(Math.max(1, options.page ?? 1)),
  });
  const result = await cachedBackendCatalog(params.toString());
  if (!result.ok) throw new CatalogUnavailableError(result.error);
  if (result.value.empty) throw new CatalogUnavailableError("the backend catalog is empty (not synced yet)");
  return assembleResult(result.value, options);
}

export type CatalogListProduct = Pick<BackendOverviewProduct, "handle" | "vendor" | "createdAt" | "featuredImage" | "images">;

/**
 * Every product (light fields, catalog order) for the nav's brand tiles and the
 * sitemap. Empty when the backend can't answer: the nav then shows brand tiles
 * without images and the sitemap lists only collection pages.
 */
export async function getCatalogProductList(): Promise<CatalogListProduct[]> {
  if (!isBackendConfigured()) return [];
  const result = await cachedBackendOverview();
  if (!result.ok) {
    console.error(`[catalog] product list unavailable: ${result.error}`);
    return [];
  }
  return result.value.products;
}
