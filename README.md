# ZJ Headless Storefront

Next.js App Router storefront for a Shopify shop (Nike / Adidas demo catalog). Uses the **Storefront API** for catalog/cart/checkout and the **Customer Account API** (OAuth + PKCE) for login, orders, addresses, profile, and favourites — no local customer database.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Shopify GraphQL `2026-10`

## Features

| Area | What’s included |
|------|-----------------|
| Catalog | Home, collections (filters/sort, infinite scroll with retry), product detail, search + predictive search |
| Cart | Cookie cart, slide-out drawer, instant (optimistic) quantity changes batched into one request, discounts, Shopify hosted checkout |
| Stock | Quantity limited to available stock, “Only N left”, sold-out and backorder states; Shopify’s stock warnings shown on cart lines |
| Account | Login/signup via Shopify, overview, orders (newer/older paging), addresses CRUD with country list, profile |
| Signed-in checkout | Cart is linked to the customer (buyer identity) on login, so checkout is tied to their account |
| Favourites | Login-required hearts on cards/PDP; synced to customer metafield `custom.favourites` |
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

Copy from `.env.example`. Never prefix Storefront or Customer Account secrets with `NEXT_PUBLIC_`.

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
| `SHOPIFY_WEBHOOK_SECRET` | Webhook signing secret (see [Instant catalog updates](#instant-catalog-updates-webhooks)) |
| `SUPPORT_EMAIL` | Optional; shows a “Need help?” email button on order pages |

Full Admin steps (Headless channel, New customer accounts, favourites metafield): **[docs/customer-accounts-admin.md](docs/customer-accounts-admin.md)**.

### Favourites metafield (required)

In Shopify Admin → **Settings → Custom data → Customers**:

1. Add definition, namespace/key **`custom.favourites`**, type **JSON**
2. **Customer Account API access:** Read and write

Without this, saving favourites fails with a metafield access error.

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
| `/api/webhooks/shopify` | Shopify webhook receiver (signed) |

`app/error.tsx` and `app/global-error.tsx` show a branded “Something went wrong” page with **Try again**.

## Project layout

```
app/           Pages, account OAuth routes, cart/favourites actions, API routes, UI
lib/           Shopify Storefront + Customer Account clients, cart, catalog, stock, favourites
proxy.ts       Rate limiting, logout origin check, account return path (Next 16 Proxy)
docs/          Customer Account Admin setup, architecture audit
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

npx tsx scripts/test-cart.ts <product-handle>   # live cart smoke test (hits Shopify)
npx tsx scripts/audit-unit.ts                   # unit asserts: checkout URL, money, sale price,
                                                # return paths, rate limiter, webhook signatures
```

## Deploy

Deploy on Vercel (or any Node host). Set the same env vars in the host, and add the production callback URL in the Headless Customer Account API settings.

Local Customer Account login needs an HTTPS callback that matches Admin (tunnel) unless you only test catalog/cart anonymously.

## Instant catalog updates (webhooks)

Catalog data is cached and refreshed every 2 minutes as a backup. Shopify webhooks make edits show within seconds:

1. Shopify admin → **Settings → Notifications → Webhooks → Create webhook**. Format **JSON**, URL `https://<your-site>/api/webhooks/shopify`. Create one for each event:
   - Product creation, Product update, Product deletion
   - Collection creation, Collection update, Collection deletion
   - Inventory level update
2. Copy the signing secret shown on that page ("Your webhooks will be signed with …") into `SHOPIFY_WEBHOOK_SECRET` in Vercel, then redeploy.
3. Edit a product in admin and reload its page. Delivery status for each webhook is shown in admin.

The endpoint rejects unsigned requests (401) and refreshes all catalog data tagged `catalog` (`CATALOG_TAG` in `lib/shopify.ts`).

## Security notes

- Storefront token and Customer Account secrets are server-only; sessions are AES-GCM sealed in httpOnly cookies.
- Checkout URLs are host-checked on the server before reaching the browser; login `returnTo` paths must stay on-site.
- `proxy.ts` rate-limits search, catalog and Server Actions per IP (in-memory, per server instance — best effort; use Upstash or Vercel Firewall for a hard global limit) and rejects cross-site logout.
- Webhooks are verified with HMAC-SHA256 over the raw body.

## Known gaps

- Demo content in `lib/site-content.ts` (flagged `demo: true`) is hidden until replaced with real links and copy
- No policy pages (privacy, refunds, terms) or post-checkout thank-you page yet
- No analytics / cookie consent
- Single market: prices shown in the store currency, `en-US` formatting
- Variants and images are capped per product (100 variants, 12 images on the product page)
- No CI or test runner; unit asserts run manually
