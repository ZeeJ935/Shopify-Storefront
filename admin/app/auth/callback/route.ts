import { NextResponse, type NextRequest } from "next/server";
import { adminFetch, type StaffTokenResponse } from "@/lib/backend";
import { clientIpFrom } from "@/lib/client-ip";
import { readConfig } from "@/lib/env";
import { exchangeCode, safeEqual } from "@/lib/google";
import { seal, unseal } from "@/lib/seal";
import { OAUTH_COOKIE, parseOAuthAttempt, SESSION_COOKIE, sessionCookieOptions, type AdminSession } from "@/lib/session";

/**
 * Google redirects here. Checks state, swaps the code for an ID token, and lets the backend
 * verify it and check the allowlist. Every failure shows the same generic message.
 */
export async function GET(request: NextRequest) {
  const config = readConfig();
  const fail = () => {
    const response = NextResponse.redirect(new URL("/login?error=1", config.appUrl));
    response.cookies.delete({ name: OAUTH_COOKIE, path: "/auth" });
    return response;
  };

  const now = Math.floor(Date.now() / 1000);
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;
  const attempt = raw ? parseOAuthAttempt(unseal(raw, config.sessionSecret), now) : null;
  if (!code || !state || !attempt || !safeEqual(state, attempt.state)) return fail();

  let staff: StaffTokenResponse;
  try {
    const idToken = await exchangeCode({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      appUrl: config.appUrl,
      code,
      verifier: attempt.verifier,
    });
    staff = await adminFetch<StaffTokenResponse>(config, "/admin/auth/exchange", {
      method: "POST",
      body: { idToken, nonce: attempt.nonce },
      clientIp: clientIpFrom(request.headers),
    });
  } catch {
    return fail();
  }

  const session: AdminSession = { token: staff.token, tokenExpiresAt: staff.expiresAt, sessionExpiresAt: staff.sessionExpiresAt, staff: staff.staff };
  const response = NextResponse.redirect(new URL("/", config.appUrl));
  response.cookies.set(SESSION_COOKIE, seal(session, config.sessionSecret), sessionCookieOptions(session, now, config.secureCookies));
  response.cookies.delete({ name: OAUTH_COOKIE, path: "/auth" });
  return response;
}
