// Strict Content-Security-Policy with a per-request nonce (set by proxy.ts).
/** Origin Sentry's browser SDK posts to, from a DSN like https://key@o1.ingest.sentry.io/123. */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

/** `https`: the app is served over HTTPS (adds upgrade-insecure-requests; off for plain-http localhost). */
export function buildCsp(nonce: string, opts: { dev: boolean; https?: boolean; sentryDsn?: string }): string {
  const sentry = sentryIngestOrigin(opts.sentryDsn);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${opts.dev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${sentry ? ` ${sentry}` : ""}${opts.dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(opts.https && !opts.dev ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
