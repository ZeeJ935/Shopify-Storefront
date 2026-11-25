# ZJ Headless Commerce

Two projects in one repo, built on one Shopify store (Nike / Adidas demo catalog):

- **Project 1: headless storefront platform.** A Next.js storefront on the Shopify Storefront and Customer Account APIs, backed by its own service (Fastify, Postgres with Drizzle, pg-boss queue) for favourites, a webhook-synced product catalog, shared rate limiting, Sentry and health checks.
- **Project 3: inventory and order management.** Built into the same backend, plus a staff admin app (`admin/`). It syncs inventory, orders and fulfillments from the Shopify Admin API without storing customer personal data, creates fulfillments safely, syncs a mock warehouse into Shopify with compare-and-set, and has Google staff sign-in with roles and an audit log.

## What's built

| Area | Pieces | Where |
|---|---|---|
| Storefront | Catalog, search, product pages, cookie cart, Shopify checkout, Customer Account login, orders, addresses, favourites | `app/`, `lib/` → [docs/STOREFRONT.md](docs/STOREFRONT.md) |
| Backend API | `/v1` (service token): catalog, favourites, inventory, orders, fulfillments. `/health`. `/webhooks/shopify` (HMAC) | `backend/src/` → [backend/README.md](backend/README.md) |
| Catalog sync | Postgres catalog from the Storefront API: webhooks + nightly full sync, cache refresh on the storefront | `backend/src/catalog/` |
| Webhooks | Signed intake, dedupe inbox, topic router, retries, stuck detection, retention purge | `backend/src/webhooks/` |
| Inventory / orders | Admin API sync (paged, no bulk operations), ordering rule, 60-day order window | `backend/src/inventory/`, `backend/src/orders/` |
| Fulfillment | Idempotent fulfillment actions, dry run, notify defaults to false, retry reconciliation | `backend/src/fulfillments/` |
| Warehouse | Mock warehouse, diff against Shopify `on_hand`, compare-and-set push, reconcile | `backend/src/warehouse/` |
| Staff admin | Google SSO, allowlist roles, signed staff token (8 h limit), audit before action, dashboard | `backend/src/admin/`, `admin/` → [admin/README.md](admin/README.md) |
| Monitoring | Sentry (scrubbed) on all three apps, `/health` with queue depth, keep-alive workflow | [docs/RELIABILITY.md](docs/RELIABILITY.md) |

## Docs

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, request flows, scheduled jobs |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every table, its columns and the migration that created it |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, tokens, webhooks, personal data, audit log, CSP, secrets |
| [docs/RELIABILITY.md](docs/RELIABILITY.md) | Retries, idempotency, compare-and-set, ordering, failure modes, health, alerts |
| [docs/TESTING.md](docs/TESTING.md) | Test suites, counts, CI, manual checks |
| [docs/DEMO.md](docs/DEMO.md) | 7–10 minute demo script and its setup |
| [docs/LIMITS.md](docs/LIMITS.md) | Known limits and what I'd do next |
| [docs/STOREFRONT.md](docs/STOREFRONT.md) | Storefront routes, env, CSP, Sentry, after checkout |
| [backend/README.md](backend/README.md) | Backend endpoints, webhooks, sync jobs, Admin API, staff admin API, deploy |
| [admin/README.md](admin/README.md) | Admin app: sign-in, roles, pages, setup checklist, secret rotation |
| [docs/customer-accounts-admin.md](docs/customer-accounts-admin.md) | Shopify Customer Account API setup |
| [docs/architecture-audit.md](docs/architecture-audit.md) | Historical storefront audit (2026-10-28; partly superseded) |

## Quick start (local)

Needs Node 22 and Docker. Env var **names** only; values go in each app's `.env` (copy from its `.env.example`).

**1. Backend** (`backend/`, http://127.0.0.1:4000)

```bash
cd backend
cp .env.example .env
docker compose up -d --wait     # Postgres 16 on 127.0.0.1:5433
npm install
npm run db:migrate
npm run catalog:backfill        # first catalog sync
npm run dev
```

| Group | Variables |
|---|---|
| Required | `DATABASE_URL`, `BACKEND_SERVICE_TOKEN` (≥32 chars) |
| Catalog + webhooks | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `STOREFRONT_URL`, `BACKEND_PUBLIC_URL` |
| Admin API (Project 3) | `SHOPIFY_ADMIN_CLIENT_ID`, `SHOPIFY_ADMIN_CLIENT_SECRET`, `SHOPIFY_ADMIN_API_VERSION` |
| Staff admin | `ADMIN_API_TOKEN`, `ADMIN_JWT_SECRET`, `ADMIN_GOOGLE_CLIENT_ID`, `ADMIN_ALLOWLIST`, optional `ADMIN_GOOGLE_HOSTED_DOMAIN`, `ADMIN_API_TOKEN_PREVIOUS`, `ADMIN_JWT_SECRET_PREVIOUS` |
| Warehouse | `WAREHOUSE_PUSH_MODE` (`dry_run` when unset), `WAREHOUSE_MAX_DECREASE` |
| Optional | `HOST`, `PORT`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_DEBUG`, `LOG_LEVEL` |

Inventory and orders backfills: `npm run inventory:backfill`, `npm run orders:backfill`.

**2. Storefront** (repo root, http://localhost:3000)

```bash
cp .env.example .env
npm install
npm run dev
```

Variables: `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN`, `SITE_URL`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET`, `SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID`, `SHOPIFY_CUSTOMER_ACCOUNT_CALLBACK_URL`, `SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_REDIRECT_URL`, `SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET`, `BACKEND_URL`, `BACKEND_SERVICE_TOKEN`. Optional: `SUPPORT_EMAIL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SHOPIFY_OFFERS_NAMESPACE`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DEBUG`, `CSP_ENFORCE`.

Customer Account login locally needs an HTTPS callback that matches the Shopify settings (a tunnel). Catalog and cart work without it.

**3. Admin app** (`admin/`, http://localhost:3001)

```bash
cd admin
cp .env.example .env
npm install
npm run dev
```

Variables: `BACKEND_URL`, `ADMIN_API_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_SESSION_SECRET`, `ADMIN_APP_URL`. Optional: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`. Without Google: `cd backend && npm run admin:token -- you@example.com` prints a staff token for curl (local database only).

## Tests

| Suite | Command | Count |
|---|---|---|
| Backend, no database | `cd backend && npm test` | 166 run, 66 skipped |
| Backend, with database | `cd backend && npm test` with `DATABASE_URL` set | 232 |
| Admin app | `cd admin && npm test` | 25 |
| Storefront unit | `npm test` | 25 test functions, 209 assertions |
| Playwright (browser) | `npm run build && npm run e2e` | 6 |

Counts are from runs on 2026-11-26. Details, CI jobs and manual checks: [docs/TESTING.md](docs/TESTING.md).

## Deploy

- Storefront and admin app: two Vercel projects (admin uses Root Directory `admin`).
- Backend and Postgres: Render, from [`render.yaml`](render.yaml). The admin and Admin API variables are added in the Render dashboard; they are not in the blueprint.
- Keep-alive and queue alerts: [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml).

Steps: [backend/README.md](backend/README.md), [admin/README.md](admin/README.md), [docs/STOREFRONT.md](docs/STOREFRONT.md#deploy).
