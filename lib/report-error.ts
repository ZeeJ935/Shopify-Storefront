import * as Sentry from "@sentry/nextjs";

/** A short, log-safe description (name and message, trimmed). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}

/**
 * Server-side: an error that needs attention. Always a short log line; also a
 * Sentry event (tagged, scrubbed) when SENTRY_DSN is set. Never throws.
 */
export function reportError(error: unknown, tags: { area: string } & Record<string, string>) {
  console.error(`[${tags.area}]`, describeError(error));
  if (!process.env.SENTRY_DSN?.trim()) return;
  try {
    Sentry.captureException(error, { tags });
  } catch {
    // Reporting must never break the request.
  }
}
