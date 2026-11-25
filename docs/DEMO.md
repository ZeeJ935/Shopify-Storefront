# Demo script (7–10 minutes)

## Setup (before the demo)

| Need | How |
|---|---|
| Backend awake and synced | Open `<backend>/health` a minute before: `db: "up"`, catalog/inventory/orders not `stale`. On a sleeping free instance the first call takes about a minute. |
| Storefront | Deployed URL or `npm run dev` (port 3000) with `BACKEND_URL` set |
| Admin app | Deployed URL or `cd admin && npm run dev` (port 3001) |
| Test shopper | A Shopify customer account you can log in with (email code) |
| Staff accounts | Your Google account in `ADMIN_ALLOWLIST` as `admin`. Optional: a second account as `viewer` to show roles |
| An open order | Place a test order (Shopify Bogus Gateway or a test payment) so it has an `OPEN` fulfillment order. Wait for the order webhook, or as admin use the **Sync** menu on `/audit` → **Orders sync** |
| Warehouse in dry run | `WAREHOUSE_PUSH_MODE` unset or `dry_run` on the backend (the warehouse page shows a banner) |
| A warehouse difference | As admin on `/warehouse`, set one SKU's mock stock 2 above Shopify's `on_hand` |
| Tabs open | storefront home, admin `/orders`, admin `/warehouse`, `<backend>/health` |

## Script

| Time | Show | Say |
|---|---|---|
| **0:00** | Storefront home → a collection. Use a brand filter and sort by price; scroll to load more. | Listings come from the backend's Postgres catalog, kept in sync by Shopify webhooks plus a nightly full sync. Filters and paging run in SQL. |
| **1:00** | Open a product, pick a size, **Add to cart**. Drawer opens; change quantity. Open `/cart`. | Cart and checkout stay on Shopify's Storefront API. Quantities are capped by stock; the checkout URL is host-checked on the server. |
| **2:00** | Signed out, tap a heart. You land on login with the product remembered. Log in (Customer Account API). | Login is OAuth with PKCE; the session is a sealed `httpOnly` cookie. |
| **2:45** | Back on the product: the heart is filled. Open `/account/favourites`. | Favourites live in Postgres keyed by the customer's Shopify ID. If the backend is down they show as "not loaded" and nothing is overwritten. |
| **3:15** | Admin app `/login` → **Sign in with Google**. Land on the dashboard. | Google code + PKCE. The backend checks the allowlist and issues a 15-minute staff token; the session ends after 8 hours no matter what. |
| **3:45** | `/orders`: filter by status, open the test order. | Orders are synced from the Admin API without customer names, emails or addresses. Staff look those up in Shopify admin by order number. |
| **4:30** | `/inventory`: search a SKU, show levels per location. | Paged Admin API sync, no bulk operations. Older updates never overwrite newer ones (`shouldApply`). |
| **5:00** | On the order, **Fulfill**: pick quantities, leave *Notify customer* unticked, **Dry run**. | The dry run shows exactly what would be sent. Notify defaults to false. |
| **5:45** | **Confirm**. Progress page shows `pending` → `succeeded`. Double-click confirm on a fresh screen to show only one action. | The confirm screen carries one sealed idempotency key, so repeats replay instead of fulfilling twice. The job re-checks quantities live in Shopify. |
| **6:45** | `/warehouse`: the dry-run banner, the SKU showing **Differs +2**. Select it → **Review push**. | Mock warehouse vs Shopify `on_hand`. The confirm screen lists from → to; large decreases need an extra tick. |
| **7:30** | **Run dry run**. Progress page: log row `Dry run 20 → 22`, status **Done**. | In live mode this is `inventorySetQuantities` with compare-and-set: if a sale happened in between, Shopify refuses, and the job re-reads and retries up to 3 times. |
| **8:15** | `/audit` (admin only). Show `auth.login`, `fulfillment.create`, `warehouse.push`, `warehouse.stock`. | Every change writes a pending audit row first; if that write fails, the action is refused. |
| **8:45** | Optional: sign in as the viewer. No Fulfill, no push, no stock editing, no Audit. | Roles are enforced by the backend; the UI just hides what you can't do. |
| **9:15** | `<backend>/health`. | DB status, sync staleness, stuck webhooks, queue depth and oldest job, warehouse differences. A GitHub workflow pings it every 10 minutes and fails (email) on a sustained breach. |

## After the demo

- Set the mock stock back so the diff shows **In sync**.
- The fulfillment you confirmed is real in Shopify (on a test order). Cancel or archive the order there if needed.

## If something goes wrong

| Problem | Do |
|---|---|
| Catalog shows "couldn't load products" | Backend asleep or down: open `/health`, wait, **Try again** |
| Admin shows "Your session ended" | Sign in again (8-hour limit or allowlist change) |
| Order not in the admin | Webhook not processed yet: as admin, `/audit` → **Sync** → **Orders sync**, or check `/health` → `webhooks` |
| Fulfill says the fulfillment order isn't synced | Same as above; the order's fulfillment data syncs with the order |
| Warehouse push refused `warehouse_not_configured` | The backend has no Admin API credentials |
| Fulfill or push refused `audit_unavailable` | Database problem; nothing was done. Check `/health` |
