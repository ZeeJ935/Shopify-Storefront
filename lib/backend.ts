import "server-only";
import { getCustomerId } from "@/lib/customer-account/session";
import { pickFavouritesStore } from "@/lib/favourites-store";

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

/** True when both backend variables are set. Until then, favourites stay on the Shopify metafield. */
export function isBackendConfigured() {
  const { BACKEND_URL, BACKEND_SERVICE_TOKEN } = process.env;
  return pickFavouritesStore({ BACKEND_URL, BACKEND_SERVICE_TOKEN }) === "postgres";
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

export function importBackendFavourites(customerId: string, ids: string[]) {
  return backendFetch<BackendFavourites>("/v1/favourites/import", { customerId, method: "POST", body: { ids } });
}
