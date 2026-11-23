import { connection } from "next/server";

/**
 * Throws on purpose so error reporting can be checked end to end. Off (404)
 * unless SENTRY_DEBUG=1, so it's never reachable by accident in production.
 */
export async function GET() {
  await connection();
  if (process.env.SENTRY_DEBUG !== "1") {
    return new Response("Not found", { status: 404 });
  }
  throw new Error("Sentry test error from the storefront (GET /api/debug/sentry)");
}
