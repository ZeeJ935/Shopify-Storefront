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
| GET | `/health` | none | `{ ok, db, catalog: { lastSyncAt, stale }, inventory: { lastSyncAt, stale }, orders: { lastSyncAt, stale }, webhooks: { failedLast24h, stuck, oldestStuckAt }, adminApi? }`. `503` only when the database is down; a stale catalog/inventory/orders sync (none in 26 h), failed or stuck webhooks, or Admin API warning are fields, not a failure. `adminApi` is present only when Admin credentials are configured |
| GET | `/v1/inventory/locations` | token | All locations (`id`, name, active, fulfillsOnlineOrders) |
| GET | `/v1/inventory/levels` | token | Levels with optional `sku`, `location_id`, `low_stock_below`, `cursor`, `limit` (≤100). Keyset pagination; `nextCursor` when more |
| GET | `/v1/inventory/items/:id` | token | Item by Shopify GID or numeric id, levels per location, last 20 history rows |
| POST | `/v1/inventory/sync` | token | Queues a full inventory sync; `202` (`503` if Admin isn't configured) |
| GET | `/v1/orders` | token | Orders with optional `status`, `financial_status`, `fulfillment_status`, `from`, `to`, `sku`, `cursor`, `limit` (≤100). Newest first; `nextCursor` when more |
| GET | `/v1/orders/:id` | token | Order by Shopify GID or numeric id, with lines, `fulfillmentOrders` (with lines) and `fulfillments` |
| POST | `/v1/fulfillments` | token + `Idempotency-Key` | Fulfill one fulfillment order (see [Fulfillment actions](#fulfillment-actions)). `202` queued, `200` dry run or replay, `409` key reused with a different body, `422` fails checks, `503` if Admin is off (dry runs still work) |
| GET | `/v1/fulfillments/:key` | token | Status of a fulfillment action by its idempotency key |
| POST | `/v1/orders/sync` | token | Queues a full orders sync (last 60 days); `202` (`503` if Admin isn't configured) |
| GET | `/v1/me` | token + customer ID | `{ customerId, firstSeenAt }`; records the customer (insert, or update `last_seen_at`) |
| GET | `/v1/favourites` | token + customer ID | `{ ids, imported }` (`imported` is from the old one-time migration; the storefront ignores it) |
| PUT | `/v1/favourites` | token + customer ID | Body `{ ids }`: replaces the whole list. Duplicates are collapsed; more than 200 → `400 too_many_favourites` |
| POST | `/v1/favourites/import` | token + customer ID | Body `{ ids }`: one-time import used during the migration from the Shopify metafield. No longer called by the storefront; kept for a possible manual re-import. A repeat call changes nothing |
| GET | `/v1/catalog` | token | Catalog query: `scope`, `brand`, `type`, `gender`, `size`, `color`, `sale`, `available`, `price_min`, `price_max`, `sort`, `page` or `cursor`, `limit` (≤100), `q`. Products, totals, facet counts, `nextCursor`; `empty: true` if nothing is synced yet |
| GET | `/v1/products/by-ids` | token | `?ids=a,b` (≤250): products in the order asked, unknown IDs skipped |
| GET | `/v1/catalog/overview` | token | Light product list in catalog order (handle, brand, image, dates) for the nav and sitemap |
| GET | `/v1/debug/sentry` | token | Only when `SENTRY_DEBUG=1`. Throws on purpose, to test error reporting (see below) |
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
| `SENTRY_DEBUG` | Optional. `1` turns on `GET /v1/debug/sentry`; any other value or unset leaves it off (404) |
| `ADMIN_API_TOKEN` | Optional (staff admin). Shared secret with the admin app's server for `/admin/*`; ≥32 chars, different from every other secret. All of `ADMIN_API_TOKEN`, `ADMIN_JWT_SECRET`, `ADMIN_GOOGLE_CLIENT_ID` unset → `/admin` is off; only some set → the service refuses to start |
| `ADMIN_API_TOKEN_PREVIOUS` | Optional. Also accepted during rotation |
| `ADMIN_JWT_SECRET` | Staff admin. Signs staff JWTs (HS256); ≥32 chars |
| `ADMIN_JWT_SECRET_PREVIOUS` | Optional. Still verifies (never signs) during rotation |
| `ADMIN_ALLOWLIST` | Staff admin. `email:role` entries, comma or newline separated; roles `viewer`, `operator`, `admin`. Bad entries stop the service from starting |
| `ADMIN_GOOGLE_CLIENT_ID` | Staff admin. The admin app's Google OAuth client id (ID token audience) |
| `ADMIN_GOOGLE_HOSTED_DOMAIN` | Optional. Only Google Workspace accounts of this domain may sign in |

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
3. **Topic router.** Handled topics are dispatched to an ordered list of handlers (several handlers can share one topic; on retry the whole chain re-runs — handlers must be idempotent). On `inventory_levels/update` the order is catalog → inventory → revalidate. Topics whose real handler is not configured (Admin off) fall back to placeholder handlers that log topic + id only.
4. **Process in a queue.** pg-boss (Postgres, schema `pgboss`; no Redis) runs in the API process. Catalog topics clear the storefront's cache by calling `POST {STOREFRONT_URL}/api/revalidate` with the service token.
5. **Retry, then fail.** A failed attempt is retried with exponential backoff (about 30 s, 1, 2, 4 min), 5 attempts in total. After that the event gets `failed_at`, and `last_error` keeps the reason (no query values or secrets).

**Catalog topics** (full payload stored): `products/create`, `products/update`, `products/delete`, `collections/create`, `collections/update`, `collections/delete`, `inventory_levels/update`.

**Inventory topics** (Admin re-fetch; payload id only for items/locations): `inventory_levels/update` (second handler), `inventory_items/update`, `locations/create|update|delete`.

**Orders topics** (Admin re-fetch; payload `{ id }` only): `orders/create`, `orders/paid`, `orders/updated`, `orders/cancelled`.

**Stored payloads for non-catalog topics** (never emails, names, addresses or phones): inventory/location/order topics keep `{ id }`; `fulfillments/create|update` keep `{ id, order_id }`; `fulfillment_orders/*` keep `{ ids }` (the FulfillmentOrder GIDs found in the payload). Unknown topics are recorded without a payload and ignored.

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
- a stuck webhook with no attempts left: `kind=webhook`, `topic`, `event_id`, `reason=stuck`
- a maintenance job that failed its last attempt: `kind=job`, `job=webhook-maintenance|webhook-purge`
- a catalog sync that failed its last attempt: `kind=job`, `job=catalog-full-sync`, `reason`
- uncaught exceptions and unhandled promise rejections

Before anything is sent, request bodies (webhook payloads), cookies, query strings, the `authorization` / `x-customer-id` / signature headers and user data are dropped, and tokens and email addresses in messages are masked (`src/sentry-scrub.ts`). Performance traces are sampled at 10%.

**Test it:** set `SENTRY_DEBUG=1` (the route is off otherwise), then `curl -H "Authorization: Bearer $BACKEND_SERVICE_TOKEN" https://<your-api>/v1/debug/sentry` returns 500 and sends a "Sentry test error" event (tagged `kind=request`). Without a DSN it's only logged.

**Logs.** One JSON line per request: `reqId`, `method`, `route` (the pattern, never the URL, so no query strings), `status`, `durationMs`. Headers, bodies and webhook payloads are never logged; the service token, customer ID, signature and cookie headers are also redacted as a safety net.

**Health.** `GET /health` is safe to point an uptime monitor at: it's `503` only when the database is down. Check `catalog.stale`, `inventory.stale`, `orders.stale`, `webhooks.failedLast24h`, `webhooks.stuck`, and `adminApi` (when configured) for slower problems. An Admin API failure is a warning field, not a `503`.

**Stuck webhooks and retention** (`src/webhooks/maintenance.ts`, pg-boss):

| Queue | Schedule (UTC) | What it does |
|-------|----------------|--------------|
| `webhook-maintenance` | every 15 min | Events neither processed nor failed and received over 30 min ago are *stuck* (usually the worker died mid-attempt). With attempts left: queued again (handlers are idempotent; one copy per event per 15 min). With none left: marked failed and reported. |
| `webhook-purge` | `0 5 * * *` | Deletes processed events older than 30 days and failed events older than 90 days, 5,000 rows per statement. Pending events are never deleted. |

`webhooks.stuck` on `/health` counts stuck events; `oldestStuckAt` is when the oldest one arrived.

## Locations and inventory

Inventory lives in Postgres (`locations`, `inventory_items`, `inventory_levels`, `inventory_level_history`, `inventory_state`) and is kept in sync from the **Admin GraphQL API** (paged reads; no bulk operations). Nested levels are fetched in pages of 25; remaining pages for an item are always followed.

**Kept in sync by:**
- **Webhooks.** `inventory_levels/update` re-fetches that level from Admin (payload ids only) and upserts if `shouldApply` allows; history is written when `available` changes. Catalog still schedules a debounced full product sync on the same topic. `inventory_items/update` and `locations/create|update|delete` re-fetch or delete accordingly. Deleting a location cascades its levels; history rows are kept (`ON DELETE SET NULL` plus denormalized Shopify ids).
- **A nightly full sync** (03:30 UTC, pg-boss). If the service was asleep then, it runs once on wake. Stale sync data never overwrites a newer webhook update (`shouldApply`). Missing rows are removed only after a complete successful read.

**Backfill:** on first start with empty `locations`, a full sync is queued via the same singleton as manual sync (restarts do not pile up jobs). To run one by hand: `npm run inventory:backfill` (local), `npm run inventory:backfill:prod` (compiled), or `POST /v1/inventory/sync`.

## Orders

Orders live in Postgres (`orders`, `order_lines`, `orders_state`) synced from the **Admin GraphQL API** with `read_orders` only (last **60 days**). **No personal data** is stored or requested: no customer, email, phone, addresses, or notes. Staff that need those details fetch them live from Shopify later.

**Kept in sync by:**
- **Webhooks.** `orders/create|paid|updated|cancelled` use the payload `id` only, re-fetch the order from Admin, and upsert if `shouldApply` allows. `webhook_events` stores `{ id }` only. If Admin returns null or an access error (order older than 60 days), the event is logged (topic + id) and marked processed — no retry and no Sentry.
- **A nightly full sync** (04:00 UTC). Pages orders with `updated_at` in the last 60 days (50 per page, nested lines in pages of 25). Never deletes older orders outside the window. Line prune for an order runs only after all of that order’s line pages were fetched, in one transaction with the upsert.

**Backfill:** on first start with an empty `orders` table, a sync is queued via the same singleton as manual sync. To run one by hand: `npm run orders:backfill`, `npm run orders:backfill:prod`, or `POST /v1/orders/sync`.

## Fulfillment orders and fulfillments

Stored per order in `fulfillment_orders`, `fulfillment_order_lines` and `fulfillments` (all cascade with the order), synced from the **Admin GraphQL API** (`src/fulfillments/`). **No personal data:** `destination`, `deliveryMethod`, addresses and contact fields are never requested or stored. Tracking company/number/url (first entry) are stored.

**Kept in sync by** re-fetching the whole order's fulfillment data (fulfillment orders paged by 25, their lines by 50; `Order.fulfillments` is an unpaged list read up to 100):
- **Orders webhooks and the nightly orders sync**, after an order upsert, only when the order is new, its `updated_at` changed, or `orders.fulfillments_synced_at` is null (so the nightly run skips unchanged orders).
- **`fulfillment_orders/*` webhooks**: resolve the order from the first accessible fulfillment order id, then refresh it.
- **`fulfillments/create|update` webhooks**: refresh by `order_id`. If the order is not stored yet, it is fetched and upserted first.

Rows are only overwritten by an equal-or-newer Shopify `updatedAt`. Rows missing from a complete fetch are deleted, except rows written since that fetch started (a newer concurrent refresh); fulfillments are never pruned when the list may have been truncated (100 entries). An order Shopify will not return (older than 60 days) is skipped and logged.

### Fulfillment actions

`POST /v1/fulfillments` creates a fulfillment through Admin `fulfillmentCreate` (scope `write_merchant_managed_fulfillment_orders`). Staff login will call it later through `/admin` routes; for now the service token is enough.

```http
POST /v1/fulfillments
Authorization: Bearer <BACKEND_SERVICE_TOKEN>
Idempotency-Key: 8–200 chars of A-Z a-z 0-9 . _ : -   (a UUID is ideal)

{
  "fulfillment_order_id": "gid://shopify/FulfillmentOrder/123",   // or "123"
  "lines": [{ "id": "gid://shopify/FulfillmentOrderLineItem/456", "quantity": 1 }],  // omit = all remaining
  "tracking": { "company": "UPS", "number": "1Z…", "url": "https://…" },          // optional; url needs number
  "notify_customer": false,   // default false — no customer email unless set to true
  "dry_run": true             // default false
}
```

- **Idempotency.** One `fulfillment_actions` row per key. The same key with the same body returns the existing action (`replayed: true`) and never queues a second job; the same key with a different body (including `dry_run`) is `409`.
- **Checks** against synced data before anything is saved: the fulfillment order exists and is `OPEN`/`IN_PROGRESS`, every line belongs to it, and quantities are within what remains (`422` with the reason). The job checks again live before calling Shopify.
- **Dry run** saves the action as `dry_run` and returns `wouldSend` (the exact `fulfillmentCreate` input). No job, no Shopify call.
- **Real runs** are saved as `pending` with a `fulfillment-create` pg-boss job in the same transaction (3 attempts, 30 s backoff). The job marks the action `submitting`, re-checks live, calls `fulfillmentCreate`, then stores `succeeded` + the fulfillment id and refreshes the order's fulfillment data. Shopify `userErrors` or a failed live check are final (`failed`, no retry). After the last failed attempt the action is `failed` and reported to Sentry (`kind=job`, `job=fulfillment-create`).
- **No double fulfillments on retry.** `fulfillmentCreate` has no `@idempotent` support in 2026-10, so a retry that finds the action still `submitting` (the earlier attempt may have reached Shopify) first looks for a fulfillment on that fulfillment order created since that attempt (60 s clock slack) and adopts it instead of sending again. Known gap: if staff fulfill the same fulfillment order by hand in that window, the retry adopts their fulfillment.
- The stored request holds the fulfillment order id, lines, tracking and the notify flag only — never addresses or contact details.

Statuses: `pending` → `submitting` → `succeeded` | `failed`; `dry_run` rows never run.

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
- `read_fulfillments` (needed for `fulfillments/*` subscriptions; add it on a new app version and reinstall)

`read_all_orders` is **not** added yet.

### Register app webhook subscriptions

Catalog webhooks (`products/*`, `collections/*`, `inventory_levels/update`) stay as **manual** subscriptions in Shopify admin. The app’s subscription list cannot see those, so registering them again would double-deliver every event. `npm run webhooks:register` therefore only creates app subscriptions for:

| Topics | Scope |
|--------|--------|
| `inventory_items/update` | `read_inventory` |
| `locations/create`, `update`, `delete` | `read_locations` |
| `orders/create`, `paid`, `updated`, `cancelled` | `read_orders` (may fail until protected customer data access is approved — expected) |
| `fulfillments/create`, `update` | `read_fulfillments` (fails until the new app version is installed) |
| selected `fulfillment_orders/*` (exact API names only) | `read_merchant_managed_fulfillment_orders` |

```bash
# set BACKEND_PUBLIC_URL=https://<your-api>.onrender.com (and Admin env vars)
npm run webhooks:register -- --dry-run   # print would_create / would_update / skipped
npm run webhooks:register                # create/update; continues after per-topic failures; exit 1 if any failed
```

Callback URL: `{BACKEND_PUBLIC_URL}/webhooks/shopify`.

## Staff admin API (`/admin/*`)

For the internal admin app (`admin/`, built separately). Entirely separate from `/v1`: its own token, staff identity, roles and audit log. `/v1` behaves exactly as before.

**How a staff member gets in**
1. The admin app runs Google sign-in (authorization code + PKCE, `state`, `nonce`) on its server and gets a Google ID token.
2. Its server calls `POST /admin/auth/exchange` (`Authorization: Bearer <ADMIN_API_TOKEN>`, body `{ idToken, nonce }`, and `x-admin-client-ip: <browser IP>` for rate limiting).
3. The backend verifies the ID token against Google's published keys (issuer, audience = `ADMIN_GOOGLE_CLIENT_ID`, expiry, nonce, `email_verified`, `hd` if `ADMIN_GOOGLE_HOSTED_DOMAIN` is set), looks the email up in `ADMIN_ALLOWLIST`, records the `staff` row, and returns a **staff JWT** (15 min) plus `sessionExpiresAt` (sign-in + 8 h).
4. Every other call sends `Authorization: Bearer <ADMIN_API_TOKEN>` **and** `X-Staff-Token: <jwt>`. The browser never calls the backend.
5. `POST /admin/auth/refresh` (same headers) returns a new token. It re-checks the allowlist every time and **never extends past 8 hours from the original Google sign-in**; after that, sign in with Google again.

**Staff JWT:** HS256 only (`none` and every other algorithm are rejected), `kid` derived from the key, issuer `zj-backend`, audience `zj-admin`, 30 s clock tolerance; claims `sub` (staff id), `email`, `role`, `sst` (sign-in time), `iat`, `exp`, `jti`. On every request the **current** allowlist decides: removed → 401, role changed → the new role applies immediately.

**Sign-in errors** are deliberately identical: every exchange/refresh failure (not on the allowlist, bad or expired token, nonce mismatch, bad body, session over) returns `401 {"error":"sign_in_failed"}`. Both routes are rate limited per client IP in memory (exchange 10/min, refresh 30/min) → `429` with `Retry-After`.

**Roles** (`viewer` < `operator` < `admin`; each includes the ones before):

| Method | Path | Role |
|--------|------|------|
| POST | `/admin/auth/exchange`, `/admin/auth/refresh` | admin token only |
| GET | `/admin/me` | viewer |
| GET | `/admin/orders`, `/admin/orders/:id` | viewer (same filters/shape as `/v1`) |
| GET | `/admin/inventory/locations`, `/levels`, `/items/:id` | viewer |
| GET | `/admin/fulfillments/:key` | viewer |
| POST | `/admin/fulfillments` | operator (same body as `/v1/fulfillments`, `Idempotency-Key` required; records `created_by_staff_id`) |
| POST | `/admin/sync/catalog`, `/admin/sync/inventory`, `/admin/sync/orders` | admin |
| GET | `/admin/audit?before=&limit=` | admin (newest first) |

**Audit log** (`audit_log`): staff id/email, role, action, resource, result, status, request id, small `detail` (allowlisted keys only). Never customer data or request bodies.
- **Changes fail closed:** `POST /admin/fulfillments` and `POST /admin/sync/*` write a `pending` row **before** acting; if that write fails the action is refused (`503 audit_unavailable`). The row is then completed (`success`, `rejected`, `error`).
- **Best effort:** sign-ins (`auth.login`), refused refreshes, and every `403` (`denied`). A rejected sign-in stores only a keyed hash of the email.

**Customer details:** the dashboard and these routes show **no customer names, emails or addresses** — we don't store them. If staff need them, they look the order up **in Shopify admin by its order number** (e.g. `#1007`).

**Library:** `jose` **6.2.14** (pinned exactly), backend only. Zero dependencies, maintained, standards-complete JOSE implementation built on Node's WebCrypto; used for HS256 staff tokens and for verifying Google ID tokens against Google's JWKS (with caching). 6.2.14 rather than the newest release because it had been published for over two weeks when added.

### Rotating secrets
- **`ADMIN_API_TOKEN`:** set the old value as `ADMIN_API_TOKEN_PREVIOUS` and a new `ADMIN_API_TOKEN` on the backend → deploy → update the admin app's `ADMIN_API_TOKEN` → deploy → remove `ADMIN_API_TOKEN_PREVIOUS`.
- **`ADMIN_JWT_SECRET`:** set the old value as `ADMIN_JWT_SECRET_PREVIOUS` and a new `ADMIN_JWT_SECRET` → deploy. Existing tokens keep working; refreshes get new-key tokens. Remove the previous value after 8 hours (the maximum session). **Emergency** (leaked key): replace it without setting a previous value; everyone signs in again.
- **Remove someone:** delete them from `ADMIN_ALLOWLIST` and redeploy; their next request is refused.
- Generate secrets with `openssl rand -base64 48`. Never reuse one secret for two variables (the service refuses to start).

## Warehouse sync (mock warehouse)

No real warehouse exists yet. `src/warehouse/adapter.ts` defines the `WarehouseAdapter` interface (`getStock(sku)`, `listStock()`); `MockWarehouse` keeps its stock in `warehouse_stock` (SKU × Shopify location × quantity), edited with `PUT /admin/warehouse/stock`. A real warehouse would be another adapter.

**Why `on_hand`:** the warehouse reports **physical** stock, which is Shopify's `on_hand`. Pushes set `on_hand`; Shopify then derives `available` (on_hand − committed − reserved), so units already committed to orders aren't sold twice. The diff shows `available` and `committed` read-only so staff can see what's sellable.

**Diff** (`GET /admin/warehouse/diff`, viewer): each warehouse row vs our Shopify mirror — `match`, `differs`, `large_decrease` (warehouse − on_hand below −`WAREHOUSE_MAX_DECREASE`), or why it can't be pushed: `unknown_location`, `unknown_sku`, `ambiguous_sku` (SKU on more than one item — never guessed), `untracked`, `not_stocked`. `stale` marks mirror levels older than 30 min; the **`warehouse-reconcile`** job (every 30 min, or `POST /admin/warehouse/reconcile`) re-reads them live from Shopify (`shouldApply` ordering) and records the difference count in `warehouse_state`.

**Push** (`POST /admin/warehouse/push`, operator, `Idempotency-Key`, body `{ "all": true }` or `{ "skus": [...] }`, optional `allow_large_decrease`, `dry_run`):
- The audit row is written **before** anything happens (fail closed); same key + body replays, another body is `409`, nothing pushable is `422`.
- One `warehouse-push-item` job per inventory item, pg-boss **`stately`** policy keyed by item: one active + one queued per item, so two pushes for an item never run at once. A push for an item that already has a queued job logs `skipped_already_queued` for that item so the push still finishes. An advisory lock per item is a second guard.
- Per location the job reads Shopify's **live** `on_hand`, reads the warehouse quantity, then: equal → `skipped_no_change`; decrease beyond the threshold without `allow_large_decrease` → `skipped_large_decrease`; dry run → `dry_run` (logs from → to, sends nothing); otherwise `inventorySetQuantities` (`name: "on_hand"`, `reason: "correction"`, `changeFromQuantity` = the live on_hand, required `@idempotent` key derived from push × item × location × attempt × from).
- **`CHANGE_FROM_QUANTITY_STALE`** (a sale or another change landed after our read): Shopify is **not** changed; logged `conflict`, re-read, retried up to 3 times, then `conflict_gave_up` (reported to Sentry).
- Every decision is in `stock_push_log`; `GET /admin/warehouse/pushes/:key` shows the push and its log. No personal data anywhere.

| Env | Default | Meaning |
|-----|---------|---------|
| `WAREHOUSE_PUSH_MODE` | `dry_run` | Global switch. `dry_run` = every push only logs what it would set. Set `live` to write to Shopify. |
| `WAREHOUSE_MAX_DECREASE` | `10` | Largest on_hand decrease a push may make without `allow_large_decrease`. |

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
| `npm run inventory:backfill` | One-shot Admin inventory full sync (local) |
| `npm run inventory:backfill:prod` | Same, from compiled `dist/` |
| `npm run orders:backfill` | One-shot Admin orders sync, last 60 days (local) |
| `npm run orders:backfill:prod` | Same, from compiled `dist/` |
| `npm run webhooks:register` | Create/update app webhook subscriptions via Admin API (`--dry-run` supported) |
