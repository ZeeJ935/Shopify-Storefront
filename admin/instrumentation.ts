import type { Instrumentation } from "next";

// Server error reporting; skipped entirely when SENTRY_DSN is unset.
const enabled = () => Boolean(process.env.SENTRY_DSN?.trim());

export async function register() {
  if (enabled() && process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!enabled()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
