// Removes secrets and customer data from Sentry events before they leave the
// server. Pure, so it's unit tested (test/observability.test.ts).

const SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-customer-id",
  "x-shopify-hmac-sha256",
  "x-shopify-access-token",
  "x-shopify-storefront-access-token",
]);

/** Masks bearer tokens, long token-like strings and email addresses in free text. */
export function scrubText(text: string): string {
  return text
    .replace(/bearer\s+[^\s"',]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[redacted]");
}

const stripQuery = (url: string) => url.split("?")[0];

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

function scrubHeaders(headers: unknown) {
  if (!isObj(headers)) return headers;
  const out: Loose = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? "[redacted]" : value;
  }
  return out;
}

/** Deeply masks strings (used for extra/contexts/breadcrumb data). */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (isObj(value)) {
    const out: Loose = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|secret|password|authorization|cookie|payload|email|customer/i.test(k) ? "[redacted]" : scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubBreadcrumb<T>(breadcrumb: T): T {
  const b = breadcrumb as Loose;
  if (typeof b.message === "string") b.message = scrubText(b.message);
  if (isObj(b.data)) {
    const data = b.data as Loose;
    if (typeof data.url === "string") data.url = stripQuery(data.url);
    b.data = scrubDeep(data);
  }
  return breadcrumb;
}

/**
 * beforeSend / beforeSendTransaction: no request bodies (webhook payloads),
 * cookies, query strings, secret headers or user data; tokens and emails masked.
 */
export function scrubEvent<T>(event: T): T {
  const e = event as Loose;
  if (isObj(e.request)) {
    const req = e.request as Loose;
    delete req.data;
    delete req.cookies;
    delete req.query_string;
    if (typeof req.url === "string") req.url = stripQuery(req.url);
    req.headers = scrubHeaders(req.headers);
  }
  delete e.user;
  if (typeof e.message === "string") e.message = scrubText(e.message);
  if (isObj(e.exception) && Array.isArray((e.exception as Loose).values)) {
    for (const ex of (e.exception as { values: Loose[] }).values) {
      if (typeof ex.value === "string") ex.value = scrubText(ex.value);
    }
  }
  if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map((b) => scrubBreadcrumb(b));
  if (e.extra !== undefined) e.extra = scrubDeep(e.extra);
  if (isObj(e.contexts)) {
    // Keep runtime/os/trace contexts; mask anything else.
    for (const [k, v] of Object.entries(e.contexts)) {
      if (!["runtime", "os", "trace", "app", "device", "culture", "cloud_resource"].includes(k)) (e.contexts as Loose)[k] = scrubDeep(v);
    }
  }
  return event;
}
