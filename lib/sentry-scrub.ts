// Removes cookies, auth headers and customer data from Sentry events before
// they're sent (server and browser). Pure, so it's unit tested in scripts/audit-unit.ts.

const SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-customer-id",
  "x-zj-return-to",
  "x-shopify-storefront-access-token",
  "x-shopify-hmac-sha256",
]);

/** Masks bearer tokens, emails, customer IDs, phone numbers and long token-like strings. */
export function scrubText(text: string): string {
  return text
    .replace(/bearer\s+[^\s"',]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/gid:\/\/shopify\/Customer\/\d+/g, "gid://shopify/Customer/[id]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[redacted]");
}

/** Query strings can carry return paths, codes and state; keep only the path. */
const stripQuery = (url: string) => url.split(/[?#]/)[0];

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

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|session|email|phone|address|customer|first_?name|last_?name/i;

function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (isObj(value)) {
    const out: Loose = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubDeep(v, depth + 1);
    return out;
  }
  return value;
}

export function scrubBreadcrumb<T>(breadcrumb: T): T {
  const b = breadcrumb as Loose;
  if (typeof b.message === "string") b.message = scrubText(b.message);
  if (isObj(b.data)) {
    const data = b.data as Loose;
    for (const key of ["url", "from", "to"]) if (typeof data[key] === "string") data[key] = stripQuery(data[key] as string);
    b.data = scrubDeep(data);
  }
  return breadcrumb;
}

/** beforeSend / beforeSendTransaction for the app. */
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
  if (typeof e.transaction === "string") e.transaction = stripQuery(e.transaction);
  if (isObj(e.exception) && Array.isArray((e.exception as Loose).values)) {
    for (const ex of (e.exception as { values: Loose[] }).values) {
      if (typeof ex.value === "string") ex.value = scrubText(ex.value);
    }
  }
  if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map((b) => scrubBreadcrumb(b));
  if (e.extra !== undefined) e.extra = scrubDeep(e.extra);
  if (isObj(e.contexts)) {
    for (const [k, v] of Object.entries(e.contexts)) {
      if (!["runtime", "os", "trace", "app", "device", "browser", "culture", "cloud_resource"].includes(k)) {
        (e.contexts as Loose)[k] = scrubDeep(v);
      }
    }
  }
  return event;
}

/** Shared Sentry options for the server and the browser. */
export const SENTRY_COMMON_OPTIONS = {
  tracesSampleRate: 0.1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ["content-type", "user-agent", "accept-language"] }, response: false },
    httpBodies: [] as never[],
    urlQueryParams: false,
    graphQL: { document: true, variables: false },
  },
  beforeSend: <T,>(event: T) => scrubEvent(event),
  beforeSendTransaction: <T,>(event: T) => scrubEvent(event),
  beforeBreadcrumb: <T,>(breadcrumb: T) => scrubBreadcrumb(breadcrumb),
};
