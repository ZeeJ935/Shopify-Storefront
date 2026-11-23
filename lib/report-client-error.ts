/**
 * Browser-side error reporting for error pages. Sentry is loaded only when
 * NEXT_PUBLIC_SENTRY_DSN is set (inlined at build time, so without it Sentry
 * isn't in the bundle). Errors that came from the server (they carry a digest)
 * were already reported there by instrumentation.ts, so they're not sent twice.
 */
export function reportClientError(error: unknown, area: string) {
  console.error(error);
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (error instanceof Error && "digest" in error && (error as { digest?: string }).digest) return;
  void import("@sentry/nextjs")
    .then((Sentry) => Sentry.captureException(error, { tags: { area } }))
    .catch(() => {});
}
