import { NextResponse, type NextRequest } from "next/server";
import { createRateLimiter, isSameOrigin } from "@/lib/rate-limit";
import { RETURN_TO_HEADER } from "@/lib/return-to";

const WINDOW_MS = 60_000;

// Module scope persists for the life of a server instance (Proxy runs on Node.js).
const checkRateLimit = createRateLimiter();

/** Requests per minute per IP, by kind of request. */
function rateLimitBucket(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/predictive-search") return { name: "search", limit: 60 };
  if (pathname === "/api/catalog") return { name: "catalog", limit: 60 };
  // Server Actions (cart, favourites, account) are POSTs carrying this header.
  if (request.method === "POST" && request.headers.has("next-action")) {
    return { name: "action", limit: 120 };
  }
  return null;
}

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function proxy(request: NextRequest) {
  const { pathname, search, origin } = request.nextUrl;

  // Logout clears cookies; refuse cross-site form posts that would log people out.
  if (
    request.method === "POST" &&
    pathname === "/account/logout" &&
    !isSameOrigin(request.headers.get("origin"), origin)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bucket = rateLimitBucket(request);
  if (bucket) {
    const result = checkRateLimit(
      `${bucket.name}:${clientIp(request)}`,
      bucket.limit,
      WINDOW_MS,
    );
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        },
      );
    }
  }

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
