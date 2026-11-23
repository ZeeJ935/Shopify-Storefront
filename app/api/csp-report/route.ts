import * as Sentry from "@sentry/nextjs";
import { createViolationDeduper, parseCspReports } from "@/lib/csp";

const MAX_BODY = 16 * 1024;
// One log line (and Sentry event) per distinct violation per hour, per server instance.
const firstInWindow = createViolationDeduper();

/**
 * Receives Content-Security-Policy violation reports (Report-Only for now).
 * Keeps only the directive, the blocked origin and the page path. Nothing
 * else from the report is logged or stored.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return new Response(null, { status: 413 });

  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  for (const violation of parseCspReports(body)) {
    if (!firstInWindow(violation)) continue;
    console.warn(`[csp] would block ${violation.directive} ${violation.blocked} on ${violation.page}`);
    if (process.env.SENTRY_DSN?.trim()) {
      Sentry.captureMessage(`CSP would block ${violation.directive} ${violation.blocked}`, {
        level: "warning",
        tags: { area: "csp", directive: violation.directive, blocked: violation.blocked },
        extra: { page: violation.page },
      });
    }
  }
  return new Response(null, { status: 204 });
}
