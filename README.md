# ZJ Headless Storefront

Next.js App Router storefront for a Shopify shop (Nike / Adidas demo catalog). Uses the **Storefront API** for catalog/cart/checkout and the **Customer Account API** (OAuth + PKCE) for login, orders, addresses, profile, and favourites — no local customer database.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Shopify GraphQL `2026-10`

## Features

| Area | What’s included |
|------|-----------------|
| Catalog | Home, collections (filters/sort), product detail, search + predictive search |
| Cart | Cookie cart, line qty, discounts, Shopify hosted checkout |
| Account | Login/signup via Shopify, overview, orders, addresses CRUD, profile |
| Favourites | Login-required hearts on cards/PDP; synced to customer metafield `custom.favourites` |
| SEO | `sitemap.ts`, `robots.ts`, Shopify CDN images |

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
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Storefront API token |
| `SITE_URL` | Public origin (sitemap, metadata, logout fallback) |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` | Headless channel confidential client |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | Client secret |
| `SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID` | Shop ID from Headless / Customer Account setup |
| `SHOPIFY_CUSTOMER_ACCOUNT_CALLBACK_URL` | Must match Admin exactly (e.g. `…/account/callback`) |
| `SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET` | ≥32 chars (`openssl rand -base64 48`) |
| `SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_REDIRECT_URL` | Optional; defaults to `SITE_URL` |

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
| `/search` | Search results |
| `/cart` | Cart |
| `/account/login` | Login entry (`returnTo`, optional `add` product id) |
| `/account/authorize` · `/account/callback` · `/account/logout` | OAuth |
| `/account` · `/orders` · `/addresses` · `/profile` | Protected account |
| `/account/favourites` | Favourites page (navbar heart; not in account tabs) |

## Project layout

```
app/           Pages, account OAuth routes, cart/favourites actions, UI
lib/           Shopify Storefront + Customer Account clients, cart, catalog, favourites
docs/          Customer Account Admin setup
scripts/       Local helpers (cart smoke, unit asserts) — run with npx tsx
```

Marketing copy and brand labels live in `lib/site-content.ts`.

## Scripts

```bash
npm run dev      # development
npm run build    # production build
npm run start    # serve build
npm run lint     # eslint

npx tsx scripts/test-cart.ts <product-handle>
npx tsx scripts/audit-unit.ts
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

## Known gaps

- Demo content in `lib/site-content.ts` (flagged `demo: true`) is hidden until replaced with real links and copy
