import { NextResponse, type NextRequest } from "next/server";
import { adminFetch, type StaffTokenResponse } from "./lib/backend";
import { clientIpFrom } from "./lib/client-ip";
import { buildCsp } from "./lib/csp";
import { readConfig } from "./lib/env";
import { seal, unseal } from "./lib/seal";
import { parseSession, SESSION_COOKIE, sessionAction, sessionCookieOptions, type AdminSession } from "./lib/session";

/** Reachable without a session. */
const PUBLIC_PATHS = new Set(["/login", "/auth/google", "/auth/callback", "/logout"]);

/**
 * Every page: a fresh CSP nonce. Protected pages: a valid session, refreshed with the
 * backend when the staff token is about to expire; past the 8-hour limit (or if the
 * backend refuses, e.g. removed from the allowlist) → /login with the cookie cleared.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    https: process.env.ADMIN_APP_URL?.trim().startsWith("https://"),
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const withCsp = (response: NextResponse) => {
    response.headers.set("content-security-policy", csp);
    return response;
  };
  const toLogin = (query = "") => {
    const response = withCsp(NextResponse.redirect(new URL(`/login${query}`, request.url)));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  };

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  const config = readConfig();
  const now = Math.floor(Date.now() / 1000);
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = raw ? parseSession(unseal(raw, config.sessionSecret)) : null;
  const action = sessionAction(session, now);
  if (action === "login") return toLogin(session ? "?expired=1" : "");
  if (action === "ok") return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  // Refresh: the backend re-checks the allowlist and never extends past the 8-hour limit.
  let fresh: AdminSession;
  try {
    const r = await adminFetch<StaffTokenResponse>(config, "/admin/auth/refresh", {
      method: "POST",
      staffToken: session!.token,
      clientIp: clientIpFrom(request.headers),
    });
    fresh = { token: r.token, tokenExpiresAt: r.expiresAt, sessionExpiresAt: r.sessionExpiresAt, staff: r.staff };
  } catch {
    return toLogin("?expired=1");
  }
  const sealed = seal(fresh, config.sessionSecret);
  // This request's server components read the fresh cookie too.
  request.cookies.set(SESSION_COOKIE, sealed);
  requestHeaders.set("cookie", request.cookies.toString());
  const response = withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions(fresh, now, config.secureCookies));
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
