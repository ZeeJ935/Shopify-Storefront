# ZJ backend

Separate API service for the storefront: Node, Fastify, TypeScript, Postgres (Drizzle migrations).

Only the Next.js **server** calls it. The browser never does.

## How auth works

Every `/v1/*` request needs two headers:

| Header | Meaning |
|--------|---------|
| `Authorization: Bearer <BACKEND_SERVICE_TOKEN>` | Proves the caller is the storefront server. Wrong or missing → `401` |
| `x-customer-id: <id>` | The Shopify customer the storefront is acting for (the ID token's `sub`, stored in the storefront session). Invalid or missing → `400` |

The token is checked first, so a caller without it learns nothing about the other header. The storefront side lives in `lib/backend.ts` (`backendFetch`, `getBackendMe`).

## Endpoints

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| GET | `/health` | none | `{ ok, db, catalog: { lastSyncAt, stale }, webhooks: { failedLast24h }, adminApi? }`. `503` only when the database is down; a stale sync (none in 26 h), failed webhooks, or Admin API warning are fields, not a failure. `adminApi` is present only when Admin credentials are configured |
| GET | `/v1/me` | token + customer ID | `{ customerId, firstSeenAt }`; records the customer (insert, or update `last_seen_at`) |
| GET | `/v1/favourites` | token + customer ID | `{ ids, imported }` (`imported` is from the old one-time migration; the storefront ignores it) |
| PUT | `/v1/favourites` | token + customer ID | Body `{ ids }`: replaces the whole list. Duplicates are collapsed; more than 200 → `400 too_many_favourites` |
| POST | `/v1/favourites/import` | token + customer ID | Body `{ ids }`: one-time import used during the migration from the Shopify metafield. No longer called by the storefront; kept for a possible manual re-import. A repeat call changes nothing |
| GET | `/v1/catalog` | token | Catalog query: `scope`, `brand`, `type`, `gender`, `size`, `color`, `sale`, `available`, `price_min`, `price_max`, `sort`, `page` or `cursor`, `limit` (≤100), `q`. Products, totals, facet counts, `nextCursor`; `empty: true` if nothing is synced yet |
| GET | `/v1/products/by-ids` | token | `?ids=a,b` (≤250): products in the order asked, unknown IDs skipped |
| GET | `/v1/catalog/overview` | token | Light product list in catalog order (handle, brand, image, dates) for the nav and sitemap |
| GET | `/v1/debug/sentry` | token | Throws on purpose, to test error reporting (see below) |
| POST | `/v1/catalog/sync` | token | Queues a full catalog sync; `202` (`503` if Storefront access isn't configured) |
| POST | `/webhooks/shopify` | Shopify HMAC (no service token) | Records the event, drops duplicates, answers `200` at once; catalog topics are processed by the queue (see below) |

**Favourites data:** the `favourites` table holds `(customer_id, product_id, created_at)`, unique per customer and product, in the order they were added. `customers.favourites_imported_at` records when a customer's list moved to Postgres, so an emptied list is never re-imported.

## Environment

Names only. Copy `.env.example` to `.env`.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `BACKEND_SERVICE_TOKEN` | Shared secret, ≥32 chars; must match the storefront's `BACKEND_SERVICE_TOKEN` |
| `HOST` | Listen address (default `127.0.0.1`) |
| `PORT` | Listen port (default `4000`) |
| `LOG_LEVEL` | Optional; default `info` |
| `SHOPIFY_WEBHOOK_SECRET` | Signing secret for webhooks created in Shopify admin. App subscriptions use `SHOPIFY_ADMIN_CLIENT_SECRET` instead. Either is accepted; if neither is set, webhooks get `500` |
| `STOREFRONT_URL` | Storefront origin, for clearing its cache (`POST /api/revalidate`). Without it, catalog webhooks fail and retry |
| `SHOPIFY_STORE_DOMAIN` | Store domain for Storefront catalog sync and Admin API (same as the storefront's). Without it and the Storefront token, catalog sync is off; without it and Admin client credentials, Admin is off |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Storefront API token for catalog sync (same as the storefront's) |
| `SHOPIFY_ADMIN_CLIENT_ID` | Dev Dashboard app client ID for the Admin API (client credentials grant). Without it and the secret below, Admin stays off |
| `SHOPIFY_ADMIN_CLIENT_SECRET` | Dev Dashboard app client secret for the Admin API |
| `SHOPIFY_ADMIN_API_VERSION` | Pinned GraphQL Admin API version (default `2026-10`) |
| `BACKEND_PUBLIC_URL` | Public origin of this API (no trailing slash). Used by `npm run webhooks:register`. Optional at API start |
| `SENTRY_DSN` | Optional. Sentry project DSN; without it error reporting is off and nothing else changes |
| `SENTRY_ENVIRONMENT` | Optional. Environment name shown in Sentry (default: `NODE_ENV`) |

## Run locally

```bash
cd backend
cp .env.example .env            # then set BACKEND_SERVICE_TOKEN (openssl rand -base64 48)
npm install
docker compose up -d --wait     # Postgres 16 on 127.0.0.1:5433
npm run db:migrate
npm run dev                     # http://127.0.0.1:4000/health
```

In the storefront's `.env`, set `BACKEND_URL=http://127.0.0.1:4000` and the same `BACKEND_SERVICE_TOKEN`.

Stop with Ctrl+C and `docker compose down`. The data volume is kept; `docker compose down -v` deletes it.

## Shopify webhooks

`POST /webhooks/shopify` is public: Shopify signs every webhook, and the HMAC (`X-Shopify-Hmac-Sha256`, over the raw body) is the auth. **Either** `SHOPIFY_WEBHOOK_SECRET` (webhooks created in Shopify admin) **or** `SHOPIFY_ADMIN_CLIENT_SECRET` (app-created subscriptions) is accepted; each check is constant-time. A bad or missing signature gets `401`. If neither secret is set, the route returns `500` so Shopify retries later.

1. **Record and dedupe.** Each webhook is stored once in `webhook_events`, keyed by `X-Shopify-Webhook-Id`. A repeat delivery gets `200 {"ok":true,"duplicate":true}` and is ignored. Storing the event and queueing it happen in one transaction, so a failure leaves nothing behind and Shopify's retry is processed normally. `X-Shopify-Triggered-At` and `X-Shopify-Api-Version` are stored when present (`triggered_at`, `api_version`).
2. **Answer fast.** The response is sent as soon as the event is stored; processing happens in the queue.
3. **Topic router.** Handled topics are dispatched to an ordered list of handlers (several handlers can share one topic; on retry the whole chain re-runs — handlers must be idempotent). Catalog topics keep the previous behaviour. Placeholder handlers for orders/locations/inventory items/fulfillments log topic + id only until later steps fill them in.
4. **Process in a queue.** pg-boss (Postgres, schema `pgboss`; no Redis) runs in the API process. Catalog topics clear the storefront's cache by calling `POST {STOREFRONT_URL}/api/revalidate` with the service token.
5. **Retry, then fail.** A failed attempt is retried with exponential backoff (about 30 s, 1, 2, 4 min), 5 attempts in total. After that the event gets `failed_at`, and `last_error` keeps the reason (no query values or secrets).

**Catalog topics** (full payload stored): `products/create`, `products/update`, `products/delete`, `collections/create`, `collections/update`, `collections/delete`, `inventory_levels/update`.

**Placeholder topics** (queued; payload stored as `{ id }` only — never emails, names, addresses or phones): `inventory_items/update`, `locations/create|update|delete`, `orders/create|paid|updated|cancelled`, `fulfillments/create|update`, and any `fulfillment_orders/*` topic. Unknown topics are recorded without a payload and ignored.

**What's stuck or failed:**
```sql
select webhook_id, topic, attempts, last_error, received_at
from webhook_events where processed_at is null order by received_at desc;
```

### Try it locally with a signed payload

With the backend running (`npm run dev`) and `SHOPIFY_WEBHOOK_SECRET` set in `backend/.env`:

```bash
SECRET=$(grep '^SHOPIFY_WEBHOOK_SECRET=' .env | cut -d= -f2-)
BODY='{"id":1234567890,"title":"Test product"}'
HMAC=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -i -X POST http://127.0.0.1:4000/webhooks/shopify \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: products/update" \
  -H "X-Shopify-Shop-Domain: your-store.myshopify.com" \
  -H "X-Shopify-Webhook-Id: local-test-1" \
  -H "X-Shopify-Hmac-Sha256: $HMAC" \
  --data "$BODY"
```

- `200 {"ok":true}`: stored and queued. With the storefront running at `STOREFRONT_URL`, it logs the cache clear.
- Run it again: `200 {"ok":true,"duplicate":true}`. Change `X-Shopify-Webhook-Id` for a new event.
- Change one character of `BODY` after computing `HMAC`: `401`.

### Point Shopify at the backend

1. On Render, set `SHOPIFY_WEBHOOK_SECRET` and `STOREFRONT_URL`, and redeploy. `curl -i -X POST https://<your-api>.onrender.com/webhooks/shopify` should return `401` (not `404`).
2. Shopify admin → **Settings → Notifications → Webhooks**. For each event (product, collection and inventory level create/update/delete), edit the URL to `https://<your-api>.onrender.com/webhooks/shopify`, format JSON. The signing secret stays the same.
3. Click **Send test** on one webhook, or edit a product. A row appears in `webhook_events` with `processed_at` set, and the product page shows the change within seconds.


**Free plan:** the API sleeps after 15 minutes idle and takes about a minute to wake. Shopify waits only a few seconds, so a webhook that arrives while it sleeps times out and Shopify retries it later (the 2-minute cache refresh still applies meanwhile). If deliveries keep failing for a long time, Shopify can remove the webhook; an always-on plan avoids this.

**Keep-alive:** `.github/workflows/keepalive.yml` pings `/health` every 10 minutes so the free instance doesn't sleep (catalog pages depend on it). Set the repository variable `BACKEND_HEALTH_URL` (Settings → Secrets and variables → Actions → Variables) to `https://<your-api>.onrender.com/health`. Without it the workflow skips. GitHub may start scheduled runs a few minutes late.

## Product catalog

Products live in Postgres (`products`, `product_collections`, `catalog_state`) and are served to the storefront by `GET /v1/catalog`, which filters, sorts, pages and counts facets in SQL with the same results as the storefront's original in-memory catalog: `test/catalog.db.test.ts` checks the SQL against frozen reference answers in `test/fixtures/catalog-parity.json`.

**Kept in sync by:**
- **Product webhooks.** `products/create` and `products/update` re-fetch that product from the Storefront API and upsert it; a product Shopify no longer shows is removed. Only the product ID is read from the payload. `products/delete` removes it.
- **Collection webhooks.** Membership of the tracked collections (`men`, `women`, `kids`, `nike`, `adidas`, `sale`, `trending`, `shoes`, `clothing`, `accessories`) is re-read.
- **Inventory webhooks.** They can't name a product, so they schedule a full sync, at most one per minute.
- **A nightly full sync** (03:00 UTC, pg-boss). If the service was asleep at that time, it runs once on wake. It re-reads everything and deletes products no longer in Shopify, but only after the whole catalog was read successfully.

After every sync the storefront's cache is cleared (`POST {STOREFRONT_URL}/api/revalidate`).

**Backfill:** on first start with an empty `products` table, a full sync is queued automatically. To run one by hand: `npm run catalog:backfill` (local), `npm run catalog:backfill:prod` (compiled, e.g. a Render shell), or `POST /v1/catalog/sync`. It's safe to run any number of times.

**Shared code:** `src/catalog-shared/` is an exact copy of the storefront's `lib/catalog-shared/` (product normalization and filter rules). After changing those files, run `npm run sync:shared`; a test fails if the copies differ.

## Monitoring

**Errors (Sentry).** With `SENTRY_DSN` set, these are reported, each tagged:
- unexpected request errors (500s): `kind=request`, `route`
- a webhook that failed its last retry: `kind=webhook`, `topic`, `event_id`
- a catalog sync that failed its last attempt: `kind=job`, `job=catalog-full-sync`, `reason`
- uncaught exceptions and unhandled promise rejections

Before anything is sent, request bodies (webhook payloads), cookies, query strings, the `authorization` / `x-customer-id` / signature headers and user data are dropped, and tokens and email addresses in messages are masked (`src/sentry-scrub.ts`). Performance traces are sampled at 10%.

**Test it:** `curl -H "Authorization: Bearer $BACKEND_SERVICE_TOKEN" https://<your-api>/v1/debug/sentry` returns 500 and sends a "Sentry test error" event (tagged `kind=request`). Without a DSN it's only logged.

**Logs.** One JSON line per request: `reqId`, `method`, `route` (the pattern, never the URL, so no query strings), `status`, `durationMs`. Headers, bodies and webhook payloads are never logged; the service token, customer ID, signature and cookie headers are also redacted as a safety net.

**Health.** `GET /health` is safe to point an uptime monitor at: it's `503` only when the database is down. Check `catalog.stale`, `webhooks.failedLast24h`, and `adminApi` (when configured) for slower problems. An Admin API failure is a warning field, not a `503`.

## Shopify Admin API

The backend talks to the GraphQL Admin API with a **Dev Dashboard** app using the [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant) (`POST /admin/oauth/access_token`). Access tokens are cached in memory and refreshed from the response `expires_in` (and on `401`). Tokens are never logged.

Admin is optional: without `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_CLIENT_ID`, and `SHOPIFY_ADMIN_CLIENT_SECRET`, the service starts as before and `/health` omits `adminApi`.

**Project 3 scopes** (declare on the app version in the Dev Dashboard):

- `read_products`
- `read_inventory`
- `write_inventory`
- `read_locations`
- `read_orders`
- `read_merchant_managed_fulfillment_orders`
- `write_merchant_managed_fulfillment_orders`

`read_all_orders` is **not** added yet. `read_fulfillments` is also not added yet (needed before registering `fulfillments/*` subscriptions).

### Register app webhook subscriptions

Catalog webhooks (`products/*`, `collections/*`, `inventory_levels/update`) stay as **manual** subscriptions in Shopify admin. The app’s subscription list cannot see those, so registering them again would double-deliver every event. `npm run webhooks:register` therefore only creates app subscriptions for:

| Topics | Scope |
|--------|--------|
| `inventory_items/update` | `read_inventory` |
| `locations/create`, `update`, `delete` | `read_locations` |
| `orders/create`, `paid`, `updated`, `cancelled` | `read_orders` (may fail until protected customer data access is approved — expected) |
| selected `fulfillment_orders/*` (exact API names only) | `read_merchant_managed_fulfillment_orders` |

`fulfillments/create` and `fulfillments/update` have placeholder handlers in the router but are **not** registered until the fulfillment step adds `read_fulfillments`.

```bash
# set BACKEND_PUBLIC_URL=https://<your-api>.onrender.com (and Admin env vars)
npm run webhooks:register -- --dry-run   # print would_create / would_update / skipped
npm run webhooks:register                # create/update; continues after per-topic failures; exit 1 if any failed
```

Callback URL: `{BACKEND_PUBLIC_URL}/webhooks/shopify`.

## Deploy on Render

`render.yaml` (repo root) defines the API and its Postgres.

1. Render dashboard → **New → Blueprint** → pick this repository. Render creates `zj-backend-db` (Postgres) and `zj-backend` (the API). Before each deploy it runs the migrations (`npm run db:migrate:prod`).
2. Open the `zj-backend` service, copy its URL (`https://….onrender.com`) and the generated `BACKEND_SERVICE_TOKEN` (Environment tab). Fill in `SHOPIFY_WEBHOOK_SECRET`, `STOREFRONT_URL`, `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` there too.
3. In Vercel → Project → Settings → Environment Variables, set `BACKEND_URL` and `BACKEND_SERVICE_TOKEN` for Production, then redeploy.
4. Check `https://<your-api>.onrender.com/health` returns `{"ok":true,"db":"up"}`.

The storefront needs these for its catalog and favourites: until they're set, catalog pages show "couldn't load products" and favourites show as not loaded.

**Plans:** `render.yaml` uses the paid Starter web service and Basic database. On the free plans, the API sleeps after 15 minutes idle (the first request then exceeds the storefront's 5 s timeout, so favourites show as not loaded), and a free database is deleted 30 days after creation, plus a 14-day grace period.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start with reload |
| `npm test` | Vitest: auth and routes with a fake database; the Postgres repo tests also run when `DATABASE_URL` is set |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Write a new SQL migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations in `drizzle/` |
| `npm run db:migrate:prod` | Same, from the compiled `dist/` (used on Render) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run webhooks:register` | Create/update app webhook subscriptions via Admin API (`--dry-run` supported) |
