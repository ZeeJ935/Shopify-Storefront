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

## Deploy on Render

`render.yaml` (repo root) defines the API and its Postgres.

1. Render dashboard → **New → Blueprint** → pick this repository. Render creates `zj-backend-db` (Postgres) and `zj-backend` (the API). Before each deploy it runs the migrations (`npm run db:migrate:prod`).
2. Open the `zj-backend` service, copy its URL (`https://….onrender.com`) and the generated `BACKEND_SERVICE_TOKEN` (Environment tab).
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
