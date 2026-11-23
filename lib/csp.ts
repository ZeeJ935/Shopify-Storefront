// Content-Security-Policy for the storefront, plus parsing of violation
// reports. Pure (no Next imports) so it's unit tested and usable from next.config.ts.
//
// Static header (no nonces): nonces would force every page to render
// dynamically and lose static/partial prerendering. The cost is
// script-src 'unsafe-inline', which Next's inline data scripts need.

export type CspEnv = {
  NODE_ENV?: string;
  /** "production" | "preview" | "development" on Vercel. */
  VERCEL_ENV?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  SHOPIFY_STORE_DOMAIN?: string;
  /** "1" sends the policy as Content-Security-Policy (enforced) instead of Report-Only. */
  CSP_ENFORCE?: string;
};

export const CSP_REPORT_PATH = "/api/csp-report";

/** The Sentry ingest origin the browser SDK posts to, from a DSN (https://key@o1.ingest.sentry.io/2). */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn?.trim()) return null;
  try {
    const url = new URL(dsn.trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function buildCsp(env: CspEnv): string {
  const dev = env.NODE_ENV === "development";
  const preview = env.VERCEL_ENV === "preview";
  const enforce = env.CSP_ENFORCE === "1";
  const sentry = sentryIngestOrigin(env.NEXT_PUBLIC_SENTRY_DSN);
  const store = env.SHOPIFY_STORE_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Vercel's preview toolbar (comments, feedback) loads from these.
  const vercelLive = preview ? ["https://vercel.live"] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...vercelLive],
    "style-src": ["'self'", "'unsafe-inline'", ...vercelLive],
    // Product images normally come through /_next/image (same origin).
    "img-src": ["'self'", "data:", "blob:", "https://cdn.shopify.com", ...(preview ? ["https://vercel.live", "https://vercel.com"] : [])],
    // next/font self-hosts the Google fonts.
    "font-src": ["'self'", "data:", ...(preview ? ["https://vercel.live", "https://assets.vercel.com"] : [])],
    "connect-src": [
      "'self'",
      ...(sentry ? [sentry] : []),
      ...(dev ? ["ws:", "wss:"] : []),
      ...(preview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : []),
    ],
    "frame-src": preview ? vercelLive : ["'none'"],
    // Logout posts here, then redirects to Shopify's logout page; Chrome checks
    // redirects after a form post against form-action.
    "form-action": ["'self'", "https://shopify.com", "https://*.shopify.com", ...(store ? [`https://${store}`] : [])],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": ["csp"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  // Ignored (with a console warning) in Report-Only, so only added when enforcing.
  if (enforce && !dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headers for next.config.ts: the policy (Report-Only unless CSP_ENFORCE=1) and the reporting endpoint. */
export function cspHeaders(env: CspEnv & { SITE_URL?: string }): { key: string; value: string }[] {
  const headers = [
    {
      key: env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
      value: buildCsp(env),
    },
  ];
  // The Reporting API needs an absolute URL; report-uri (relative) works without it.
  const site = env.SITE_URL?.trim().replace(/\/+$/, "");
  if (site && /^https?:\/\//.test(site)) {
    headers.push({ key: "Reporting-Endpoints", value: `csp="${site}${CSP_REPORT_PATH}"` });
  }
  return headers;
}

export type CspViolation = {
  /** e.g. "script-src-elem" */
  directive: string;
  /** Origin only ("https://x.example"), or a keyword like "inline" / "eval" / "data". */
  blocked: string;
  /** Page path only, no query string. */
  page: string;
};

const asString = (v: unknown) => (typeof v === "string" ? v : "");

/** Keeps the origin of a URL, or a short keyword (inline, eval, data, self, …). Never a full URL. */
function blockedOrigin(raw: string): string {
  if (!raw) return "unknown";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:") {
      return `${url.protocol}//${url.host}`;
    }
    return url.protocol.replace(/:$/, ""); // data:, blob:, chrome-extension: …
  } catch {
    return raw.slice(0, 40).replace(/[^\w-]/g, "") || "unknown";
  }
}

function pagePath(raw: string): string {
  try {
    return new URL(raw).pathname.slice(0, 200);
  } catch {
    return "unknown";
  }
}

/** Parses both report formats: legacy report-uri (application/csp-report) and the Reporting API (application/reports+json). */
export function parseCspReports(body: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  const legacy = (body as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (legacy && typeof legacy === "object") {
    out.push({
      directive: (asString(legacy["effective-directive"]) || asString(legacy["violated-directive"]).split(" ")[0] || "unknown").slice(0, 40),
      blocked: blockedOrigin(asString(legacy["blocked-uri"])),
      page: pagePath(asString(legacy["document-uri"])),
    });
  }
  if (Array.isArray(body)) {
    for (const report of body.slice(0, 20)) {
      const r = report as { type?: unknown; body?: Record<string, unknown> };
      if (r?.type !== "csp-violation" || !r.body) continue;
      out.push({
        directive: (asString(r.body.effectiveDirective) || "unknown").slice(0, 40),
        blocked: blockedOrigin(asString(r.body.blockedURL)),
        page: pagePath(asString(r.body.documentURL)),
      });
    }
  }
  return out;
}

/** True the first time a (directive, blocked, page) is seen in each window, so logs and Sentry don't flood. */
export function createViolationDeduper(windowMs = 60 * 60 * 1000, maxKeys = 2000) {
  const seen = new Map<string, number>();
  return (v: CspViolation, now = Date.now()): boolean => {
    const key = `${v.directive}|${v.blocked}|${v.page}`;
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    if (seen.size >= maxKeys) {
      for (const [k, t] of seen) if (now - t >= windowMs) seen.delete(k);
      if (seen.size >= maxKeys) seen.clear();
    }
    seen.set(key, now);
    return true;
  };
}
