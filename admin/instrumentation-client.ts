// Browser error reporting; NEXT_PUBLIC_SENTRY_DSN is inlined at build time (unset → not bundled).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) void import("./sentry.client.config");
