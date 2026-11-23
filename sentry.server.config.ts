// Sentry for the Next.js server. Loaded by instrumentation.ts only when SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_COMMON_OPTIONS } from "./lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  ...SENTRY_COMMON_OPTIONS,
});
