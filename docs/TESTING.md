# Testing

## Counts

From runs on 2026-11-26 (all passing):

| Suite | Runner | Command | Tests |
|---|---|---|---|
| Backend, unit and route | Vitest | `cd backend && npm test` | 166 (20 files) |
| Backend, database | Vitest | same, with `DATABASE_URL` set | 66 (12 files) |
| **Backend total** | | | **232** (32 files) |
| Admin app | `node:test` via `tsx --test` | `cd admin && npm test` | 25 (5 files) |
| Storefront unit | `tsx scripts/audit-unit.ts` | `npm test` | 25 test functions, 209 assertions |
| Browser (e2e) | Playwright, Chromium | `npm run e2e` | 6 (4 files) |

Without `DATABASE_URL` the database files are skipped (`describe.skipIf`), so a plain `npm test` reports 166 passed, 66 skipped.

## Backend (`backend/test/`)

Route tests build the Fastify app with fakes (`buildApp`, `test/fakes.ts`); no network.

| File | Tests | Covers |
|---|---|---|
| `admin-env` | 7 | allowlist parsing and role order; admin config all-or-nothing, secret length and reuse; dev token only on a local database |
| `admin-google` | 3 | Google ID token: audience, issuer, key, expiry, nonce, verified email, Workspace domain |
| `admin-jwt` | 6 | staff token: HS256 only, `kid`, 15 min, 8 h hard limit, refresh |
| `admin-routes` | 15 | auth layers, roles, rate limits, generic errors, no secrets in logs |
| `auth` | 8 | service token, customer ID header |
| `catalog-sync` | 13 | catalog webhooks and full sync; no deletes after a partial or empty read; shared code parity with the storefront |
| `errors` | 3 | log-safe errors (no SQL parameters) |
| `favourites` | 11 | favourites routes: auth, 200 limit, de-duplication, one-time import |
| `fulfillment-actions` | 7 | idempotency key format, validation, notify defaults to false, dry run without Admin, quantity checks |
| `fulfillments` | 13 | fulfillment sync, no personal fields requested |
| `inventory-sync` | 10 | inventory paging and deletes |
| `observability` | 14 | `/health` fields, request logs, Sentry scrubbing |
| `ordering` | 3 | `shouldApply` |
| `orders-sync` | 12 | 60-day window, access-denied skip, no personal data persisted |
| `process` | 6 | webhook processing: cache refresh, 5 attempts then failed, handler chains |
| `shopify-admin` | 14 | Admin client retries, throttling, token refresh |
| `warehouse-diff` | 5 | diff statuses and mapping guards |
| `webhook-maintenance` | 2 | stuck detection |
| `webhooks-register` | 1 | app webhook registration |
| `webhooks` | 13 | HMAC, dedupe, stored payloads per topic |

**Database tests** (`*.db.test.ts`) create a throwaway database per run against real Postgres and run the migrations:

| File | Tests | Covers |
|---|---|---|
| `admin.db` | 5 | dry run then real fulfillment audited pending → success; audit list admin-only with no customer data; summary and search; staff rows; rejected sign-in hash |
| `catalog.db` | 8 | catalog SQL parity with the old in-memory catalog, cursors, upserts and deletes |
| `favourites.db` | 3 | import once (also under concurrency), replace keeps order |
| `fulfillment-actions.db` | 11 | idempotency, replay, 409, reconcile, stored request has no personal data |
| `fulfillments.db` | 5 | fulfillment storage; older fetches never overwrite or prune newer rows |
| `inventory.db` | 6 | `shouldApply` and concurrent-insert races in SQL, history survives deletes, filters and cursors |
| `orders.db` | 4 | transactional upserts, ordering races, filters and cursors |
| `queue-health.db` | 2 | queue depth and oldest job age with real pg-boss |
| `warehouse-push.db` | 11 | compare-and-set conflicts, give-up, dry run, per-item ordering, advisory lock, idempotent keys, `skipped_already_queued` |
| `warehouse-routes.db` | 4 | roles; no audit row means 503 and no push; replay and 409 over HTTP; validation |
| `webhook-maintenance.db` | 3 | requeue, fail, purge |
| `webhooks.db` | 4 | inbox dedupe in a transaction |

Local run: `cd backend && docker compose up -d --wait`, then `npm test` with `DATABASE_URL` in `.env`.

## Admin app (`admin/test/`)

| File | Tests | Covers |
|---|---|---|
| `auth` | 9 | sealed session and 8 h limit, Google PKCE/state/nonce, backend client headers, config, strict CSP |
| `badges` | 2 | status badge mapping |
| `fulfill` | 7 | building the request, confirm tickets, failure text, nav per role |
| `sentry-scrub` | 1 | admin Sentry scrubbing |
| `warehouse` | 6 | push body from the form, confirm rows, generic tickets, viewer has no push or stock actions |

## Storefront unit (`scripts/audit-unit.ts`)

Plain assertions, no framework. Covers: checkout URL host check, money formatting and maths, sale percentage, compare-at price, `returnTo` safety, in-memory and shared rate limiters (including fail open), same-origin check, client IP, cart pending edits and notices, stock rules, customer ID from the ID token, session sealing, favourites load and login merge, service token check, shared catalog code parity with the backend, CSP header and reports, Sentry scrubbing, error reporting with Sentry off, cart discount refresh, estimated shipping, Buy X Get Y prompt.

## Playwright (`e2e/`)

| File | Tests | Flow |
|---|---|---|
| `shopping.spec.ts` | 1 | home → collection → product → add to cart → cart page (never checks out) |
| `collection.spec.ts` | 3 | brand filter, price sort, infinite scroll |
| `search.spec.ts` | 1 | predictive search, Enter for results |
| `favourites-guest.spec.ts` | 1 | guest heart goes to login with `returnTo` and the product |

Runs against a local production build on port 3100 and starts the built backend itself. Tests read whatever the catalog holds. Setup steps: [STOREFRONT.md](STOREFRONT.md#end-to-end-tests).

## Privacy tests

| Test | Checks |
|---|---|
| `backend/test/webhooks.test.ts` | order topics store only the ID; no personal data in the row or logs |
| `backend/test/orders-sync.test.ts` | personal fields in Shopify responses are never persisted |
| `backend/test/fulfillments.test.ts` | fulfillment queries never request personal fields |
| `backend/test/fulfillment-actions.db.test.ts` | the stored fulfillment request has no personal data |
| `backend/test/admin.db.test.ts` | audit rows hold no customer data; a rejected sign-in stores only a hash |
| `backend/test/admin-routes.test.ts` | logs hold no tokens, JWT secret, ID token or staff emails |
| `backend/test/observability.test.ts` | secrets never appear in log lines; Sentry scrubbing |
| `scripts/audit-unit.ts`, `admin/test/sentry-scrub.test.ts` | storefront and admin Sentry scrubbing |

## CI

`.github/workflows/ci.yml`, on push, pull request and manual runs:

| Job | Runs | When |
|---|---|---|
| `checks` | storefront lint, typecheck, `npm test`, `next build` | every run; build skipped without Shopify secrets |
| `backend` | typecheck, migrations on a Postgres 16 service, `npm test` (database tests included) | every run |
| `admin` | lint, typecheck, test, build | every run |
| `e2e` | Postgres, backend build + migrate + catalog backfill, storefront build, Playwright; uploads the report on failure | pull requests and manual runs only (not on push); skipped without secrets |

## Manual checks

These were run by hand against the local backend and the test store; they are not automated.

| Check | Result |
|---|---|
| Live warehouse push of one SKU (20 → 21), then restore (21 → 20) | both `pushed`; final diff `match` |
| Warehouse page in a browser (dry run): edit stock, confirm, progress, double click, viewer view | 14 of 14 checks passed |
| `/health` fields against the running backend | queues, `queuesWarning`, warehouse present |
| Keep-alive script against real `/health`, normal and with a forced breach | passes; breach fails after the re-check |
| `scripts/test-cart.ts <handle>` | live cart smoke test against Shopify (run with `npx tsx`; the `npm run test:cart` mentioned in its header does not exist) |
| Real fulfillment in live mode, the keep-alive run on GitHub, stale-cart clearing after a real order | **unverified** in this repo |
