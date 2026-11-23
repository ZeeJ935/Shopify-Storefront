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
| GET | `/health` | none | `{ ok, db: "up" \| "down" }`; `503` when the database is down |
| GET | `/v1/me` | token + customer ID | `{ customerId, firstSeenAt }`; records the customer (insert, or update `last_seen_at`) |
| GET | `/v1/favourites` | token + customer ID | `{ ids, imported }`. `imported: false` means the Shopify metafield hasn't been imported yet |
| PUT | `/v1/favourites` | token + customer ID | Body `{ ids }`: replaces the whole list. Duplicates are collapsed; more than 200 → `400 too_many_favourites` |
| POST | `/v1/favourites/import` | token + customer ID | Body `{ ids }`: one-time import from the metafield. A repeat call changes nothing (`imported: false`); more than 200 is trimmed |
| GET | `/v1/catalog` | token | Catalog query: `scope`, `brand`, `type`, `gender`, `size`, `color`, `sale`, `available`, `price_min`, `price_max`, `sort`, `page` or `cursor`, `limit` (≤100), `q`. Products, totals, facet counts, `nextCursor`; `empty: true` if nothing is synced yet |
| GET | `/v1/products/by-ids` | token | `?ids=a,b` (≤250): products in the order asked, unknown IDs skipped |
| GET | `/v1/catalog/overview` | token | Light product list in catalog order (handle, brand, image, dates) for the nav and sitemap |
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
| `SHOPIFY_WEBHOOK_SECRET` | Shopify's webhook signing secret (Shopify admin → Settings → Notifications → Webhooks). Without it, webhooks get `500` so Shopify retries later |
| `STOREFRONT_URL` | Storefront origin, for clearing its cache (`POST /api/revalidate`). Without it, catalog webhooks fail and retry |
| `SHOPIFY_STORE_DOMAIN` | Storefront API domain for catalog sync (same as the storefront's). Without it and the token below, catalog sync is off |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Storefront API token for catalog sync (same as the storefront's) |

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

`POST /webhooks/shopify` is public: Shopify signs every webhook, and the HMAC (`X-Shopify-Hmac-Sha256`, over the raw body, with `SHOPIFY_WEBHOOK_SECRET`) is the auth. A bad or missing signature gets `401`.

1. **Record and dedupe.** Each webhook is stored once in `webhook_events`, keyed by `X-Shopify-Webhook-Id`. A repeat delivery gets `200 {"ok":true,"duplicate":true}` and is ignored. Storing the event and queueing it happen in one transaction, so a failure leaves nothing behind and Shopify's retry is processed normally.
2. **Answer fast.** The response is sent as soon as the event is stored; processing happens in the queue.
3. **Process in a queue.** pg-boss (Postgres, schema `pgboss`; no Redis) runs in the API process. Catalog topics clear the storefront's cache by calling `POST {STOREFRONT_URL}/api/revalidate` with the service token.
4. **Retry, then fail.** A failed attempt is retried with exponential backoff (about 30 s, 1, 2, 4 min), 5 attempts in total. After that the event gets `failed_at`, and `last_error` keeps the reason (no query values or secrets).

**Catalog topics:** `products/create`, `products/update`, `products/delete`, `collections/create`, `collections/update`, `collections/delete`, `inventory_levels/update`. Any other topic is recorded (without its payload) and ignored.

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

## Product catalog

Products live in Postgres (`products`, `product_collections`, `catalog_state`) and are served to the storefront by `GET /v1/catalog`, which filters, sorts, pages and counts facets in SQL with the same results as the storefront's old in-memory catalog (checked by `test/catalog.db.test.ts` against `test/fixtures/catalog-parity.json`).

**Kept in sync by:**
- **Product webhooks.** `products/create` and `products/update` re-fetch that product from the Storefront API and upsert it; a product Shopify no longer shows is removed. Only the product ID is read from the payload. `products/delete` removes it.
- **Collection webhooks.** Membership of the tracked collections (`men`, `women`, `kids`, `nike`, `adidas`, `sale`, `trending`, `shoes`, `clothing`, `accessories`) is re-read.
- **Inventory webhooks.** They can't name a product, so they schedule a full sync, at most one per minute.
- **A nightly full sync** (03:00 UTC, pg-boss). If the service was asleep at that time, it runs once on wake. It re-reads everything and deletes products no longer in Shopify, but only after the whole catalog was read successfully.

After every sync the storefront's cache is cleared (`POST {STOREFRONT_URL}/api/revalidate`).

**Backfill:** on first start with an empty `products` table, a full sync is queued automatically. To run one by hand: `npm run catalog:backfill` (local), `npm run catalog:backfill:prod` (compiled, e.g. a Render shell), or `POST /v1/catalog/sync`. It's safe to run any number of times.

**Shared code:** `src/catalog-shared/` is an exact copy of the storefront's `lib/catalog-shared/` (product normalization and filter rules). After changing those files, run `npm run sync:shared`; a test fails if the copies differ.

## Deploy on Render

`render.yaml` (repo root) defines the API and its Postgres.

1. Render dashboard → **New → Blueprint** → pick this repository. Render creates `zj-backend-db` (Postgres) and `zj-backend` (the API). Before each deploy it runs the migrations (`npm run db:migrate:prod`).
2. Open the `zj-backend` service, copy its URL (`https://….onrender.com`) and the generated `BACKEND_SERVICE_TOKEN` (Environment tab). Fill in `SHOPIFY_WEBHOOK_SECRET`, `STOREFRONT_URL`, `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` there too.
3. In Vercel → Project → Settings → Environment Variables, set `BACKEND_URL` and `BACKEND_SERVICE_TOKEN` for Production, then redeploy.
4. Check `https://<your-api>.onrender.com/health` returns `{"ok":true,"db":"up"}`.

Until step 3 is done, the storefront keeps using the Shopify metafield, so deploying the code first is safe.

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
