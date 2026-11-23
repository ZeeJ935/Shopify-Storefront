# ZJ Headless Storefront

Next.js App Router storefront for a Shopify shop (Nike / Adidas demo catalog). Uses the **Storefront API** for catalog/cart/checkout and the **Customer Account API** (OAuth + PKCE) for login, orders, addresses and profile. Favourites are stored in Postgres through the separate [backend](backend/README.md) when it is configured.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Shopify GraphQL `2026-10`

## Features

| Area | What’s included |
|------|-----------------|
| Catalog | Home, collections (filters/sort, infinite scroll with retry), product detail, search + predictive search |
| Catalog data | Served from the backend's Postgres (`/v1/catalog`, synced by Shopify webhooks plus a nightly full sync); filters, sorting, facets and paging run in SQL. If the backend can't answer, catalog pages show a "couldn't load products" state with **Try again** (`app/collections/error.tsx`) instead of an empty catalog |
| Cart | Cookie cart, slide-out drawer, instant (optimistic) quantity changes batched into one request, discounts, Shopify hosted checkout |
| Stock | Quantity limited to available stock, “Only N left”, sold-out and backorder states; Shopify’s stock warnings shown on cart lines |
| Account | Login/signup via Shopify, overview, orders (newer/older paging), addresses CRUD with country list, profile |
| Signed-in checkout | Cart is linked to the customer (buyer identity) on login, so checkout is tied to their account |
| Favourites | Login-required hearts on cards/PDP; stored in Postgres through the backend (`BACKEND_URL`). If the backend can't be reached, favourites show as not loaded and nothing is overwritten. Guests' hearts are kept in the browser and merged in on login |
| Freshness | Shopify webhooks refresh catalog data within seconds; 2-minute timer as backup |
| Security | Server-only tokens, sealed session cookies, checkout URL and `returnTo` checks, rate limiting, signed webhooks |
| SEO | `sitemap.ts`, `robots.ts` (account/search excluded, `noindex`), Product JSON-LD, Shopify CDN images |

Guest hearts and the navbar heart send users through login with a return path (product page + pending add, or `/account/favourites`).

## Setup

```bash
cp .env.example .env
# fill values — see below
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

Copy from `.env.example`. Never prefix Storefront, Customer Account or backend secrets with `NEXT_PUBLIC_`.

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Storefront API token (needs product inventory access for stock limits) |
| `SITE_URL` | Public origin (sitemap, metadata, logout fallback) |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` | Headless channel confidential client |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | Client secret |
| `SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID` | Shop ID from Headless / Customer Account setup |
| `SHOPIFY_CUSTOMER_ACCOUNT_CALLBACK_URL` | Must match Admin exactly (e.g. `…/account/callback`) |
| `SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET` | ≥32 chars (`openssl rand -base64 48`) |
| `SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_REDIRECT_URL` | Optional; defaults to `SITE_URL` |
| `SUPPORT_EMAIL` | Optional; shows a “Need help?” email button on order pages |
| `BACKEND_URL` | Backend service origin (server-side only; see [backend/README.md](backend/README.md)) |
| `BACKEND_SERVICE_TOKEN` | Shared secret for calling the backend; must match the backend's value |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL for shared rate limiting. Optional; without it (local dev) limits are kept in memory per instance |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (pair with the URL above) |
| `SENTRY_DSN` | Optional. Sentry DSN for server errors; without it Sentry is off |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional. Sentry DSN for browser errors (usually the same value) |
| `SENTRY_AUTH_TOKEN` · `SENTRY_ORG` · `SENTRY_PROJECT` | Optional. Upload source maps at build time for readable stack traces (all three needed) |
| `SENTRY_DEBUG` | Local testing only: `1` enables `GET /api/debug/sentry`, which throws on purpose |
| `CSP_ENFORCE` | Optional. `1` enforces the Content-Security-Policy instead of Report-Only (see Content-Security-Policy) |

Full Admin steps (Headless channel, New customer accounts): **[docs/customer-accounts-admin.md](docs/customer-accounts-admin.md)**.

## Routes

| Path | Notes |
|------|--------|
| `/` | Home |
| `/collections`, `/collections/[handle]`, `/collections/all` | Browse + filters |
| `/products/[handle]` | PDP |
| `/search` | Search results (`noindex`) |
| `/cart` | Cart page (a drawer also opens after “Add to cart”) |
| `/account/login` | Login entry (`returnTo`, optional `add` product id) |
| `/account/authorize` · `/account/callback` · `/account/refresh` | OAuth start, token exchange, token refresh |
| `/account/logout` | POST only; clears session and cart |
| `/account` · `/orders` · `/addresses` · `/profile` | Protected account |
| `/account/favourites` | Favourites page (navbar heart; not in account tabs) |
| `/api/predictive-search` · `/api/catalog` | Search drawer and infinite-scroll JSON (rate limited) |
| `/api/revalidate` | Clears the catalog cache; called by the backend with `BACKEND_SERVICE_TOKEN` |

`app/error.tsx` and `app/global-error.tsx` show a branded “Something went wrong” page with **Try again**.

## Project layout

```
app/           Pages, account OAuth routes, cart/favourites actions, API routes, UI
lib/           Shopify Storefront + Customer Account clients, cart, catalog, stock, favourites
proxy.ts       Rate limiting, logout origin check, account return path (Next 16 Proxy)
docs/          Customer Account Admin setup, architecture audit
backend/       Separate API service (Fastify + Postgres); only the Next.js server calls it
scripts/       Local helpers (cart smoke, unit asserts) — run with npx tsx
```

Useful entry points:

- `app/components/cart-provider.tsx` — shared client cart: optimistic edits, request queue, drawer state
- `lib/cart.ts` — Storefront cart queries/mutations (returns Shopify’s stock warnings)
- `lib/stock.ts` — stock rules used by the product page and cart
- `lib/site-content.ts` — marketing copy and nav labels; items flagged `demo: true` are hidden until made real

## Scripts

```bash
npm run dev      # development
npm run build    # production build
npm run start    # serve build
npm run lint     # eslint
npm test         # unit asserts (scripts/audit-unit.ts): checkout URL, money, sale price,
                 # return paths, rate limiters (in-memory + shared), client IP, cart edits/notices, stock rules

npx tsx scripts/test-cart.ts <product-handle>   # live cart smoke test (hits Shopify)
npm run e2e      # browser tests (Playwright) against a local build: see End-to-end tests
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, `npm test` and `next build` on every push and pull request. The build prerenders pages from Shopify, so it needs the Shopify variables as GitHub Actions secrets; without them (for example a pull request from a fork) the build step is skipped. A second job typechecks the backend, applies its migrations to a throwaway Postgres and runs its tests.

## End-to-end tests

Playwright tests in `e2e/` drive a real browser against a **local production build**:
- **Shopping:** home → collection → product → add to cart → the drawer → the cart page. It never clicks checkout.
- **Collections:** a brand filter, sorting by price, and scrolling to load more.
- **Search:** suggestions while typing, then Enter for the results page.
- **Favourites:** a guest's heart sends them to the login page with the product remembered. The test stops before Shopify's login.

They read whatever the catalog contains, so they don't depend on specific products. They never check out, log in or delete anything (adding to cart creates a throwaway Shopify cart).

**Run locally:**
```bash
# 1. Backend with a synced catalog (once)
cd backend && docker compose up -d --wait && npm run db:migrate && npm run catalog:backfill && npm run build && cd ..
# 2. In the root .env: BACKEND_URL=http://127.0.0.1:4000 and the backend's BACKEND_SERVICE_TOKEN
# 3. Build the storefront and run the tests
npx playwright install chromium   # once
npm run build
npm run e2e
```
`npm run e2e` starts the built backend and `next start` (port 3100) itself, or reuses them if they're already running. On failure, `npx playwright show-report` and the traces in `test-results/` show what happened.

**In CI** (`.github/workflows/ci.yml`, job `e2e`), the tests run on pull requests and manual runs: a throwaway Postgres, the catalog synced from Shopify, the backend and storefront built and started, then the tests. They're skipped with a notice when the Shopify secrets aren't available (for example on pull requests from forks). On failure, the report is uploaded as an artifact.

## Deploy

Deploy on Vercel (or any Node host). Set the same env vars in the host, and add the production callback URL in the Headless Customer Account API settings.

Local Customer Account login needs an HTTPS callback that matches Admin (tunnel) unless you only test catalog/cart anonymously.

## Instant catalog updates (webhooks)

Catalog data is cached and refreshed every 2 minutes as a backup. Shopify webhooks make edits show within seconds.

Webhooks now go to the **backend** (`POST /webhooks/shopify`): it checks the signature, records each event once (duplicates are dropped), processes it in a Postgres queue with retries, and then calls this app's `POST /api/revalidate` (protected by `BACKEND_SERVICE_TOKEN`) to clear the `catalog` cache tag. Setup, a signed `curl` example and how to point Shopify at it: **[backend/README.md → Shopify webhooks](backend/README.md#shopify-webhooks)**.

Topics that refresh the catalog: product, collection and inventory level create/update/delete.

The webhook signing secret (`SHOPIFY_WEBHOOK_SECRET`) now lives only on the backend.

## Error reporting (Sentry)

With `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` set, errors go to Sentry; without them nothing changes (Sentry isn't even in the browser bundle).

- **Server:** rendering, route handler and server action errors (`instrumentation.ts` → `onRequestError`), plus errors the app catches but needs to know about (`lib/report-error.ts`: login and token refresh, cart and account actions, favourites backend failures, catalog API). The friendly error pages still show.
- **Browser:** errors caught by `app/error.tsx`, `app/collections/error.tsx` and `app/global-error.tsx`.
- **Privacy:** before sending, cookies, the `authorization` and other auth headers, request bodies, query strings and user data are removed, and emails, customer IDs, phone numbers and tokens in messages are masked (`lib/sentry-scrub.ts`). Performance traces are sampled at 10%.

**Test it locally:** set `SENTRY_DSN` and `SENTRY_DEBUG=1` in `.env`, `npm run build && npm start`, then open `/api/debug/sentry` (500 and a "Sentry test error" event). Browser errors are reported when `NEXT_PUBLIC_SENTRY_DSN` is set and an error page catches an error in the browser. The backend has its own: see `backend/README.md → Monitoring`.

## Content-Security-Policy

The site sends a **Report-Only** CSP (`lib/csp.ts`, applied in `next.config.ts`): browsers report what it *would* block, but block nothing. It allows what the storefront actually uses:
- **Its own origin**, for scripts, styles, fonts and API calls.
- **Shopify:** CDN images; Customer Account login and logout redirects (`form-action`).
- **Sentry** ingest, when `NEXT_PUBLIC_SENTRY_DSN` is set.
- **Vercel's preview toolbar**, on preview deployments only.

The Storefront and Customer Account APIs are only called from the server, and checkout is a full-page navigation, so they need no browser rules. It's a static header (no nonces) so pages stay statically rendered; the cost is `script-src 'unsafe-inline'`, which Next's inline data scripts need.

**Reading violations.** Browsers post reports to `/api/csp-report` (`report-uri`, plus `Reporting-Endpoints` when `SITE_URL` is set). Each distinct violation is logged once per hour per server instance:
```
[csp] would block script-src-elem https://example.com on /collections/men
```
- **Vercel:** Logs, search `[csp]`.
- **Sentry:** with Sentry on, warnings titled "CSP would block …", tagged `area=csp`, `directive` and `blocked`.

Only the directive, the blocked origin and the page path are kept: no query strings or full URLs. A browser extension can also cause reports (for example `chrome-extension`); those can be ignored.

**Switching to enforcing.** When the reports are quiet for a while (or only show things you're happy to block), set `CSP_ENFORCE=1` in Vercel and redeploy. The same policy is then sent as `Content-Security-Policy` (enforced), with `upgrade-insecure-requests` added. Reports keep coming, now for things actually blocked. To go back, remove the variable.

Notes:
- `frame-ancestors 'none'` takes over from `X-Frame-Options: DENY` once enforced. Both are sent, so framing is blocked either way.
- If you add a third-party script, image host or API later, add its origin to the matching directive in `lib/csp.ts` first.

## After checkout

Checkout is Shopify's hosted checkout, and afterwards shoppers see **Shopify's own thank-you and order-status page**. Shopify doesn't support redirecting from there to a custom URL (there's no return-URL option in the Storefront API, and the old "Additional scripts" redirects don't work with Checkout Extensibility). To bring shoppers back to the storefront:
1. **"Continue shopping"** on Shopify's thank-you page goes to the store's `myshopify.com` address. Install Shopify's redirect theme (the Hydrogen redirect theme) in **Online Store → Themes** and point it at your storefront URL (`SITE_URL`), so that address forwards to this site.
2. **Order confirmation email** (optional). In **Settings → Notifications → Order confirmation**, add a button linking to your storefront (for example `/account/orders`).

**The finished cart:** when the cart cookie points to a cart Shopify no longer returns, the cart page sends the shopper through `/cart/clear`, which removes the stale cookie, so they start with an empty bag. (Not tested end to end, since that needs a real order.)

## Security notes

- Storefront token and Customer Account secrets are server-only; sessions are AES-GCM sealed in httpOnly cookies.
- Checkout URLs are host-checked on the server before reaching the browser; login `returnTo` paths must stay on-site.
- `proxy.ts` rate-limits per IP: search and catalog 60/min, Server Actions 120/min (`lib/proxy-rate-limit.ts`). With `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set, the limits are shared by every server instance (Upstash Redis, sliding window, `lib/shared-rate-limit.ts`); without them, counts are kept in memory per instance (local dev). Over the limit → `429` with `Retry-After`. If Redis is unreachable, requests are allowed (fail open) and the error is logged.
- The IP comes only from Vercel's own headers (`x-vercel-forwarded-for` / `x-forwarded-for`, which Vercel overwrites so clients can't fake them; `lib/client-ip.ts`). Outside Vercel no header is trusted. This relies on Vercel being the outermost proxy: put another CDN in front and every visitor would share that CDN's IP.
- `proxy.ts` also rejects cross-site logout.
- Webhooks are verified with HMAC-SHA256 over the raw body.
- `next.config.ts` sends `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` and a Report-Only Content-Security-Policy (see above) on every response. HSTS comes from Vercel.

## Known gaps

- Demo content in `lib/site-content.ts` (flagged `demo: true`) is hidden until replaced with real links and copy
- No policy pages (privacy, refunds, terms); after checkout, shoppers see Shopify's own thank-you page (see After checkout)
- No analytics / cookie consent
- Single market: prices shown in the store currency, `en-US` formatting
- Variants and images are capped per product (100 variants, 12 images on the product page)
