// Sentry for the browser. Loaded by instrumentation-client.ts only when
// NEXT_PUBLIC_SENTRY_DSN is set (otherwise it isn't even in the bundle).
import * as Sentry from "@sentry/nextjs";
import { SENTRY_COMMON_OPTIONS } from "./lib/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  ...SENTRY_COMMON_OPTIONS,
});
