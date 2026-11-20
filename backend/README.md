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

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start with reload |
| `npm test` | Vitest: auth and routes, using a fake database |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Write a new SQL migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations in `drizzle/` |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
