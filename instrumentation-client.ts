// Browser error reporting. NEXT_PUBLIC_SENTRY_DSN is inlined at build time: when
// it's unset, this file does nothing and Sentry isn't included in the bundle.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("./sentry.client.config");
}

export function onRouterTransitionStart(...args: [string, "push" | "replace" | "traverse"]) {
  if (!dsn) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureRouterTransitionStart(...args));
}
