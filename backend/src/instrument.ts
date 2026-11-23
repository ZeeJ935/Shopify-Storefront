// Sentry error reporting. Loaded first (node --import ./dist/instrument.js, and
// as the first import in server.ts). Without SENTRY_DSN nothing is initialized
// and the service behaves exactly as before.
import * as Sentry from "@sentry/node";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub.js";

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn && !Sentry.isInitialized()) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
    // Low sample rate for performance traces; errors are always sent.
    tracesSampleRate: 0.1,
    // Collect as little as possible; scrubEvent below is a second layer.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["content-type", "user-agent", "x-shopify-topic"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: true, variables: false },
    },
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    // Request errors are reported explicitly by the app's error handler (with
    // tags); keep Fastify tracing but don't capture its errors twice.
    integrations: [Sentry.fastifyIntegration({ shouldHandleError: () => false })],
  });
}

export const sentryEnabled = Boolean(dsn);
