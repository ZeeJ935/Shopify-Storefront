import { NextResponse, type NextRequest } from "next/server";
import { RATE_LIMIT_WINDOW_MS, rateLimitResponse } from "@/lib/proxy-rate-limit";
import { isSameOrigin } from "@/lib/rate-limit";
import { RETURN_TO_HEADER } from "@/lib/return-to";
import { createSharedRateLimiter } from "@/lib/shared-rate-limit";

// Shared across all server instances via Upstash Redis when UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN are set; otherwise in memory per instance (local dev).
// Module scope persists for the life of a server instance (Proxy runs on Node.js).
const rateLimiter = createSharedRateLimiter({
  env: {
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
  windowMs: RATE_LIMIT_WINDOW_MS,
});
const platform = { VERCEL: process.env.VERCEL };

export async function proxy(request: NextRequest) {
  const { pathname, search, origin } = request.nextUrl;

  // Logout clears cookies; refuse cross-site form posts that would log people out.
  if (
    request.method === "POST" &&
    pathname === "/account/logout" &&
    !isSameOrigin(request.headers.get("origin"), origin)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const limited = await rateLimitResponse(request, rateLimiter.check, platform);
  if (limited) return limited;

  // Account layouts can't read the URL; pass it along so a forced re-login
  // returns the shopper to the same page. Always overwrite any client value.
  if (pathname.startsWith("/account")) {
    const headers = new Headers(request.headers);
    headers.set(RETURN_TO_HEADER, `${pathname}${search}`);
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets and image optimisation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",
  ],
};
