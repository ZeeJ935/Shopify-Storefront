import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminFetch, BackendError, type AdminFetchOptions } from "./backend";
import { clientIpFrom } from "./client-ip";
import { readConfig } from "./env";
import { unseal } from "./seal";
import { parseSession, SESSION_COOKIE, sessionAction, type AdminSession, type StaffRole, hasRole } from "./session";

/** The current session, or null. proxy.ts has already refreshed it if it was close to expiry. */
export async function getSession(): Promise<AdminSession | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = parseSession(unseal(raw, readConfig().sessionSecret));
  // "refresh" can only mean the proxy's refresh failed just now; treat as signed out.
  return session && sessionAction(session, Math.floor(Date.now() / 1000)) === "ok" ? session : null;
}

export async function requireSession(required: StaffRole = "viewer"): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasRole(session.staff, required)) redirect("/?forbidden=1");
  return session;
}

/**
 * Calls the backend as the signed-in staff member. A 401 (token rejected, removed from
 * the allowlist, session over) sends them to sign in again.
 */
export async function staffFetch<T>(path: string, options: Omit<AdminFetchOptions, "staffToken" | "clientIp"> = {}): Promise<T> {
  const session = await requireSession();
  const clientIp = clientIpFrom(await headers());
  let unauthorized = false;
  try {
    return await adminFetch<T>(readConfig(), path, { ...options, staffToken: session.token, clientIp });
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) unauthorized = true;
    else throw error;
  }
  // Outside the try: redirect() works by throwing.
  if (unauthorized) redirect("/login?expired=1");
  throw new Error("unreachable");
}
