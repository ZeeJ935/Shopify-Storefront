import * as Sentry from "@sentry/nextjs";
import { SENTRY_COMMON_OPTIONS } from "./lib/sentry-scrub";

Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV, ...SENTRY_COMMON_OPTIONS });
