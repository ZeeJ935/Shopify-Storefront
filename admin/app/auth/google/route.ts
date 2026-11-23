import { NextResponse } from "next/server";
import { readConfig } from "@/lib/env";
import { authorizationUrl, createAttempt } from "@/lib/google";
import { seal } from "@/lib/seal";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE } from "@/lib/session";

/** Starts Google sign-in: a fresh state, nonce and PKCE verifier in a short-lived sealed cookie. */
export async function GET() {
  const config = readConfig();
  const attempt = createAttempt(Math.floor(Date.now() / 1000));
  const response = NextResponse.redirect(authorizationUrl({ clientId: config.googleClientId, appUrl: config.appUrl, ...attempt }));
  response.cookies.set(OAUTH_COOKIE, seal(attempt, config.sessionSecret), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax", // sent on Google's top-level redirect back to /auth/callback
    path: "/auth",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return response;
}
