import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "./client-ip";
import type { LimitCheck } from "./shared-rate-limit";

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Requests per minute per IP, by kind of request. Same routes and limits as before. */
export function rateLimitBucket(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/predictive-search") return { name: "search", limit: 60 };
  if (pathname === "/api/catalog") return { name: "catalog", limit: 60 };
  // Server Actions (cart, favourites, account) are POSTs carrying this header.
  if (request.method === "POST" && request.headers.has("next-action")) {
    return { name: "action", limit: 120 };
  }
  return null;
}

/** A 429 response with Retry-After when the request is over its limit, otherwise null. */
export async function rateLimitResponse(
  request: NextRequest,
  check: LimitCheck,
  env: { VERCEL?: string },
): Promise<NextResponse | null> {
  const bucket = rateLimitBucket(request);
  if (!bucket) return null;

  const result = await check(bucket.name, clientIp(request.headers, env), bucket.limit);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
