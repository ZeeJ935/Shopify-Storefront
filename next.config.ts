import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { cspHeaders } from "./lib/csp";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
        pathname: "/s/files/**",
      },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Security headers. The Content-Security-Policy is Report-Only until
  // CSP_ENFORCE=1 (lib/csp.ts). No HSTS here: Vercel's HTTPS domains already
  // send it, and it would also affect plain http in local `next start`.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          // Report-Only until CSP_ENFORCE=1 (see lib/csp.ts and the README).
          ...cspHeaders(process.env),
        ],
      },
    ];
  },
};


// Sentry is added only when a DSN is set; otherwise the config is unchanged.
// Source maps are uploaded only when SENTRY_AUTH_TOKEN, SENTRY_ORG and
// SENTRY_PROJECT are all set (optional: errors are reported either way).
const sentryOn = Boolean(process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim());
const uploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default sentryOn
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      sourcemaps: { disable: uploadSourceMaps ? false : "disable-upload" },
    })
  : nextConfig;
