import type { Instrumentation } from "next";

// Server-side error reporting. Everything is skipped when SENTRY_DSN is unset,
// so the app behaves exactly as before.
const enabled = () => Boolean(process.env.SENTRY_DSN?.trim());

export async function register() {
  if (enabled() && process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

/** Server rendering, route handler and server action errors (the friendly error pages still show). */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!enabled()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
