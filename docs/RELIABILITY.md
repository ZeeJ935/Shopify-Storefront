# Reliability

## Retries and backoff

### Shopify Admin API client (`backend/src/shopify-admin/client.ts`)

| Setting | Value |
|---|---|
| Timeout per request | 20 s |
| Retries | up to 4 |
| Backoff | `min(8000, 250 × 2^attempt)` ms: 250, 500, 1000, 2000, 4000 |
| Retried | network errors, timeouts, HTTP 429, 5xx (including HTML gateway pages) |
| 401 | drop the cached access token, fetch a new one, retry once |
| GraphQL `THROTTLED` | wait `(requestedCost − available) / restoreRate` seconds (at least 1 s), then retry |
| Throttle floor | when fewer than 50 cost points remain, wait for the bucket to refill before the next call |
| Not retried | other GraphQL errors, `userErrors` (thrown as `ShopifyUserErrors`) |

The access token request itself has no timeout (`backend/src/shopify-admin/token.ts`).

### Other calls
- Storefront API from the backend: 20 s timeout, no inner retry; the job retry covers it.
- Backend → storefront `/api/revalidate`: 10 s timeout.
- Storefront → backend: 5 s timeout. Admin app → backend: 15 s.

### Queues

pg-boss, one pool of 3 connections (`backend/src/queue.ts`). A job that throws is retried; sync jobs report to Sentry only on the last attempt.

| Queue | Retries | Delay | Backoff | Concurrency rule |
|---|---|---|---|---|
| `shopify-webhook` | 4 (5 attempts) | 30 s | yes | requeue of stuck events uses singleton `webhook-<id>` for 15 min |
| `catalog-full-sync` | 2 | 60 s | yes | webhook-triggered resyncs debounced to one a minute |
| `inventory-full-sync` | 2 | 60 s | yes | singleton, 30 s |
| `orders-sync` | 2 | 60 s | yes | singleton, 30 s |
| `fulfillment-create` | 2 | 30 s | yes | queued in the same transaction as the action row |
| `warehouse-push-item` | 2 | 30 s | yes | `stately` policy, key `warehouse-item:<gid>`: one active plus one queued per item; 4 at a time |
| `warehouse-reconcile` | 2 | 60 s | yes | singleton, 60 s |
| `webhook-maintenance`, `webhook-purge` | 2 | 60 s | yes | — |

## Idempotency

| Where | Key | Same key + same body | Same key + different body |
|---|---|---|---|
| Webhook intake | `X-Shopify-Webhook-Id` (unique column) | `200 {duplicate: true}`, no work | — |
| `POST /v1/fulfillments`, `POST /admin/fulfillments` | `Idempotency-Key` header (8–200 chars) | returns the existing action (`replayed`) | `409 idempotency_key_reused` |
| `POST /admin/warehouse/push` | `Idempotency-Key` header | returns the existing push | `409` |
| Admin confirm screens | one key sealed per screen (`admin/lib/ticket.ts`) | a double click replays the same key | — |

A replay is checked before the quantity checks, so repeating a request after it succeeded does not fail with 422. Concurrent requests with the same key resolve through `on conflict (idempotency_key) do nothing`, and the loser gets the replay.

**Fulfillment retries.** `fulfillmentCreate` has no `@idempotent` support. If a job retry finds the action still `submitting` (an earlier attempt may have reached Shopify), it re-reads the fulfillment order and adopts a fulfillment created since the previous attempt, allowing 60 s of clock slack (`RECONCILE_SLACK_MS`), instead of sending again. See [LIMITS.md](LIMITS.md) for the gap this leaves.

**Warehouse pushes.** `inventorySetQuantities` is called with `@idempotent(key:)`. The key is a deterministic UUID (SHA-1, v5 style) of push ID, item, location, attempt and the `from` quantity (`backend/src/warehouse/shopify.ts`). A crash retry reuses the key, so Shopify returns its cached result instead of applying twice. A conflict retry changes `from` and `attempt`, so it gets a new key. A re-delivered job is skipped when a final log row already exists.

## Compare-and-set (warehouse)

Each push sets Shopify `on_hand` with `changeFromQuantity` = the live `on_hand` the job just read (`backend/src/warehouse/push.ts`):

1. Read live `on_hand` (`from`). Read the warehouse quantity (`to`).
2. Skip if `to = from` (`skipped_no_change`), or if `to − from` is below `−WAREHOUSE_MAX_DECREASE` without the allow flag (`skipped_large_decrease`). In dry run, log `dry_run` and stop.
3. Send the mutation. If Shopify answers `CHANGE_FROM_QUANTITY_STALE` (a sale or edit happened in between), log `conflict`, leave Shopify untouched, re-read and try again.
4. After 3 conflict retries, log `conflict_gave_up` and report to Sentry. The next push or reconcile picks it up.

A Postgres advisory lock per item (`pg_try_advisory_lock`) backs up the per-item queue rule, so two workers never push the same item at once.

## Ordering (`shouldApply`)

Webhooks and syncs can arrive out of order. `backend/src/webhooks/ordering.ts`:

```ts
if (existing == null || incoming == null) return true;
return incoming >= existing;
```

- Inventory levels compare `shopify_updated_at`; orders compare `updated_at`.
- The same rule is repeated in the SQL `ON CONFLICT … WHERE` clause, which covers two writers inserting the same new row at once.
- Warehouse reconcile writes through the same inventory store, so it follows the rule too.

## When something is down

| Down | What happens |
|---|---|
| **Backend** | Catalog pages show "couldn't load products" with **Try again**; cached pages keep serving. Favourites show as not loaded and no write can overwrite them. Cart, product pages and checkout keep working (they use the Storefront API directly). The admin app can't load data. |
| **Postgres** | `/health` returns 503. The backend can't start (pg-boss starts at boot). Requests fail as `500 internal_error` (logged without SQL parameters). Webhook intake fails as a whole, so Shopify retries delivery. |
| **Redis (Upstash)** | Rate limits fail open: requests are allowed and the error is logged at most once a minute. |
| **Shopify** | Admin calls retry 4 times, then the job retries. Webhook events are marked failed after 5 attempts; fulfillment actions end `failed`. `/health` shows `adminApi.ok: false` as a warning, not a 503. Orders Shopify refuses as too old are skipped, not retried. |
| **Admin API not configured** | Inventory, orders, fulfillment and warehouse features are off: their routes or jobs are absent or return `503 *_not_configured`. Fulfillment dry runs still work. `/health` leaves out `adminApi`. |
| **Sentry not configured** | No-op; errors are still logged as JSON lines. |
| **Free web instance asleep** | The first request waits for a cold start (about a minute per repo comments). The keep-alive ping exists to prevent this. |

## Health check

`GET /health` (no auth), `backend/src/routes/health.ts`:

| Field | Meaning |
|---|---|
| `ok`, `db` | 503 with `db: "down"` only when `select 1` fails |
| `catalog`, `inventory`, `orders` | `{ lastSyncAt, stale }`; stale = no full sync in 26 h |
| `webhooks` | `{ failedLast24h, stuck, oldestStuckAt }`; stuck = unprocessed for 30+ min |
| `queues` | per queue: `{ queued, active, failed, oldestQueuedSeconds }` (oldest due job in `created` or `retry`) |
| `queuesWarning` | true when a queue has more than 100 queued or its oldest due job is older than 900 s |
| `warehouse` | `{ lastReconcileAt, differences }` |
| `adminApi` | `{ ok, shop }` or `{ ok: false, warning }`, cached 60 s; only when Admin is configured |

Everything except the database is a warning field; `/health` stays 200.

## Keep-alive and alerts

`.github/workflows/keepalive.yml` runs every 10 minutes (GitHub may start it late):

1. `curl` `BACKEND_HEALTH_URL` with a 120 s timeout (a cold start can take about a minute).
2. **Breach** if any queue has more than `HEALTH_MAX_QUEUE_DEPTH` jobs waiting (default 100), any queue's oldest due job is older than `HEALTH_MAX_JOB_AGE_SECONDS` (default 900), or `webhooks.stuck > 0`.
3. On a breach or a 503, wait 60 s and check again. Fail the run only if the second check also fails. GitHub emails a failed run.
4. Unreachable or other HTTP codes only warn (the backend may be waking up).

The thresholds are repository variables. Sentry alert rules to set up by hand (warehouse give-ups, failed pushes, reconcile errors, stuck webhooks) are listed in [backend/README.md](../backend/README.md).

Tested locally against the real `/health`: default thresholds pass; a forced breach (`HEALTH_MAX_QUEUE_DEPTH=0` with one waiting job) fails after the re-check. A run on GitHub with these variables is **unverified** in this repo.
