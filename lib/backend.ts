import "server-only";
import { getCustomerId } from "@/lib/customer-account/session";
import type { CatalogRaw, ProductListItem } from "@/lib/catalog-shared/types";

// Server-side client for the /backend service. The browser never calls the
// backend: only this server holds BACKEND_SERVICE_TOKEN, and it tells the
// backend which customer it is acting for with x-customer-id.

const TIMEOUT_MS = 5_000;

export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Backend request failed: ${status} ${path}`);
    this.name = "BackendError";
  }
}

/** True when both backend variables are set (catalog and favourites need them). */
export function isBackendConfigured() {
  return Boolean(process.env.BACKEND_URL?.trim() && process.env.BACKEND_SERVICE_TOKEN?.trim());
}

function backendConfig() {
  const url = process.env.BACKEND_URL?.trim();
  const token = process.env.BACKEND_SERVICE_TOKEN?.trim();
  if (!url || !token) {
    throw new Error("BACKEND_URL and BACKEND_SERVICE_TOKEN must be set to call the backend.");
  }
  return { url: url.replace(/\/+$/, ""), token };
}

export async function backendFetch<T>(
  path: string,
  options: { customerId?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  const { url, token } = backendConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (options.customerId) headers["x-customer-id"] = options.customerId;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new BackendError(response.status, path);
  return (await response.json()) as T;
}

export type BackendMe = { customerId: string; firstSeenAt: string };

/** The signed-in customer as the backend knows them, or null when nobody is signed in. Not used by any page yet. */
export async function getBackendMe(): Promise<BackendMe | null> {
  const customerId = await getCustomerId();
  if (!customerId) return null;
  return backendFetch<BackendMe>("/v1/me", { customerId });
}

export type BackendFavourites = { ids: string[]; imported: boolean };

export function getBackendFavourites(customerId: string) {
  return backendFetch<BackendFavourites>("/v1/favourites", { customerId });
}

export async function putBackendFavourites(customerId: string, ids: string[]) {
  return (await backendFetch<{ ids: string[] }>("/v1/favourites", { customerId, method: "PUT", body: { ids } })).ids;
}

export type BackendCatalog = CatalogRaw & { nextCursor: string | null; empty: boolean };

/** GET /v1/catalog with the storefront's own query parameters (scope, filters, sort, page). */
export function getBackendCatalog(params: URLSearchParams) {
  return backendFetch<BackendCatalog>(`/v1/catalog?${params.toString()}`);
}

export type BackendOverviewProduct = Pick<ProductListItem, "handle" | "vendor" | "createdAt" | "featuredImage" | "images"> & {
  updatedAt: string | null;
};

/** Light product list in catalog order, for the nav and the sitemap. */
export function getBackendCatalogOverview() {
  return backendFetch<{ products: BackendOverviewProduct[]; empty: boolean }>("/v1/catalog/overview");
}
