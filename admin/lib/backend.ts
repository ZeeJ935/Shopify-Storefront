// Server-side client for the backend's /admin/* API. The browser never calls the backend:
// only this server holds ADMIN_API_TOKEN and the staff token (inside the sealed cookie).
// Tokens are never logged or put in error messages.
import type { AdminAppConfig } from "./env";

export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`Backend ${status} for ${path}`);
    this.name = "BackendError";
  }
}

export type AdminFetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  staffToken?: string;
  clientIp?: string;
  idempotencyKey?: string;
};

export async function adminFetch<T>(config: AdminAppConfig, path: string, options: AdminFetchOptions = {}, fetchFn: typeof fetch = fetch): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${config.adminApiToken}` };
  if (options.staffToken) headers["x-staff-token"] = options.staffToken;
  if (options.clientIp) headers["x-admin-client-ip"] = options.clientIp;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetchFn(`${config.backendUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new BackendError(response.status, path.split("?")[0], body);
  return body as T;
}

/** Token responses from /admin/auth/exchange and /admin/auth/refresh. */
export type StaffTokenResponse = {
  token: string;
  expiresAt: number;
  sessionExpiresAt: number;
  staff: { id: number; email: string; role: "viewer" | "operator" | "admin" };
};
