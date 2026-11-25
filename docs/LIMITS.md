# Limits

What this system does not do, or does only partly. Items marked **unverified** can't be confirmed from the repo.

## Hosting

| Item | What the repo says |
|---|---|
| Backend plan | `render.yaml` declares `plan: starter` (always on). The keep-alive workflow and `backend/README.md` describe running on Render's **free** plan. Which plan is actually deployed is **unverified**. |
| Free web instance | Per repo comments: sleeps after 15 minutes idle; the first request then waits about a minute. Jobs pause while asleep, which can trip the queue-age alert just after waking. While asleep, Shopify webhooks time out and are retried later; long failures can make Shopify remove a webhook. The keep-alive ping every 10 minutes exists to prevent this. |
| Database plan | `render.yaml` declares `plan: basic-256mb`. Per its comment, a **free** Render database is deleted 30 days after creation plus a 14-day grace period. The deployed plan and any expiry date are **unverified**. |
| Blueprint completeness | `render.yaml` has no `SHOPIFY_ADMIN_*`, `ADMIN_*` or `WAREHOUSE_*` variables; they are set by hand in the Render dashboard. A fresh blueprint deploy has Project 3 turned off. |
| Vercel (storefront, admin) | Plans and limits **unverified**; the repo doesn't say. |
| Upstash Redis | Optional. Plan and limits **unverified**. Without it, rate limits are per instance. |
| Sentry | Optional. Plan **unverified**. Alert rules are documented but set up by hand. |

## Project 3 scope

- **Mock warehouse only.** `MockWarehouse` stores stock in Postgres and is edited in the admin app. The `WarehouseAdapter` interface is ready for a real system, but none is connected.
- **60-day order window.** The app has `read_orders` but not `read_all_orders`, so the orders sync reads orders updated in the last 60 days. Older orders Shopify refuses are skipped. Orders already stored are never deleted.
- **No Shopify bulk operations.** All syncs page through GraphQL. A large shop syncs slowly and spends API cost. Warehouse reconcile checks at most 500 levels per run; a push takes at most 500 SKUs.
- **Fulfillment retry gap.** `fulfillmentCreate` has no idempotency support. If an attempt reaches Shopify but the response is lost, the retry adopts any fulfillment on that fulfillment order created since the last attempt (60 s slack). A manual fulfillment made in Shopify admin in that window would be adopted as ours.
- **Warehouse push is per item.** Each item and location is one live read plus one mutation. Conflicts give up after 3 retries; the next push or reconcile picks them up.
- **Staff can't see customer details.** By design: no names, emails or addresses are stored. Staff use Shopify admin by order number.
- **Admin rate limits are in memory.** `/admin/auth/*` limits are per backend process and reset on restart.
- **The live warehouse push was tested on one SKU** against the test store. A live fulfillment end to end is **unverified** in this repo.

## Storefront

- **CSP is Report-Only** unless `CSP_ENFORCE=1`, and uses `'unsafe-inline'` for scripts (static header, no nonces). Whether production enforces it is **unverified**.
- **ID token signature not verified** (Customer Account). Allowed by OIDC because the token comes straight from Shopify's token endpoint over TLS, but it is weaker than a JWKS check.
- **Rate limits fail open** when Redis is down, and trust client IPs only from Vercel's headers (another CDN in front would make every visitor share one IP).
- **Cart discounts can be stale.** Shopify recalculates cart discounts only when the cart changes. The bag re-saves an untouched cart (5+ minutes old) on load to force it; checkout always recalculates.
- **Buy X Get Y prompt** depends on the separate zj-discount-engine app publishing its offers metafield. The storefront reading that namespace is **unverified** until the engine is deployed.
- **Guest favourites** are not kept in the browser: a signed-out heart click goes to login and saves only that product after sign-in.
- Carried over from the storefront docs: no policy pages; Shopify's own thank-you page after checkout; no analytics or cookie consent; single market, `en-US` formatting; product pages cap variants at 100 and images at 12; account order timeline shows Placed → Paid → Shipped only; addresses list the first 20; orders show 10 per page.

## Operations and tests

- **E2E tests don't run on push**, only on pull requests and manual runs, and are skipped without Shopify secrets.
- **No process-level crash handlers.** The backend handles `SIGINT`/`SIGTERM` but has no `uncaughtException` / `unhandledRejection` handler of its own; it relies on Sentry's defaults when Sentry is on.
- **Admin token request has no timeout** (the GraphQL calls do: 20 s).
- **`npm run test:cart`** is mentioned in `scripts/test-cart.ts` but doesn't exist; run it with `npx tsx scripts/test-cart.ts <handle>`.
- **`docs/architecture-audit.md`** predates the backend and CI; much of it is superseded.
- **Keep-alive alert emails** go to whoever last edited the workflow's cron (GitHub's rule for scheduled workflows).

## What I'd do next

1. **Enforce the storefront CSP** with per-request nonces (as the admin app does) and drop `'unsafe-inline'`.
2. **Verify the Customer Account ID token** against Shopify's JWKS.
3. **Close the fulfillment retry gap**: record the attempt's request ID and match on fulfilled line quantities, not only on creation time.
4. **Order history beyond 60 days**: request `read_all_orders`, and use bulk operations for the first backfill.
5. **Connect a real warehouse** behind `WarehouseAdapter`, with its own webhook or polling.
6. **Harden the backend process**: crash handlers that report and exit, a timeout on the Admin token request, admin rate limits in Redis.
7. **Run Playwright on every push** against a preview deployment, and add an admin-app browser test for fulfill and push.
8. **Make deploys reproducible**: add the Project 3 variables to `render.yaml` (as `sync: false`) and pin the intended plans.
