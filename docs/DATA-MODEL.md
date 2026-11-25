# Data model

Postgres 16. Schema in [`backend/src/db/schema.ts`](../backend/src/db/schema.ts), migrations in [`backend/drizzle/`](../backend/drizzle/) (applied with `npm run db:migrate`; on Render as the pre-deploy step). 25 app tables in `public`, plus pg-boss's own schema.

## Migrations

| Migration | Creates | Alters |
|---|---|---|
| `0000_init_customers` | `customers` | — |
| `0001_favourites` | `favourites` | `customers` + `favourites_imported_at` |
| `0002_webhook_events` | `webhook_events` | — |
| `0003_catalog` | `products`, `product_collections`, `catalog_state`; extension `pg_trgm` | — |
| `0004_webhook_ordering` | — | `webhook_events` + `triggered_at`, `api_version` |
| `0005_inventory` | `locations`, `inventory_items`, `inventory_levels`, `inventory_level_history`, `inventory_state` | — |
| `0006_orders` | `orders`, `order_lines`, `orders_state` | — |
| `0007_indexes` | — | indexes on `inventory_level_history`, `orders`, `order_lines`, `webhook_events` |
| `0008_fulfillments` | `fulfillment_orders`, `fulfillment_order_lines`, `fulfillments`, `fulfillment_actions` | `orders` + `fulfillments_synced_at` |
| `0009_staff_audit` | `staff`, `audit_log` | `fulfillment_actions` + `created_by_staff_id` |
| `0010_warehouse` | `warehouse_stock`, `warehouse_pushes`, `stock_push_log`, `warehouse_state` | — |

`backend/drizzle/meta/` has no snapshot files for 0004 and 0005 (hand-written migrations listed in the journal).

All `*_id` columns that hold Shopify IDs are text GIDs (`gid://shopify/...`). Internal keys are `bigserial`.

## Project 1: customers, favourites, webhooks, catalog

### `customers` (0000, altered 0001)
One row per Shopify customer the storefront has sent.

| Column | Notes |
|---|---|
| `customer_id` text PK | Customer Account ID token `sub` (opaque Shopify ID) |
| `first_seen_at`, `last_seen_at` | timestamps |
| `favourites_imported_at` | set once the old metafield favourites were imported; null = never |

### `favourites` (0001)
Products a customer has favourited, in order.

| Column | Notes |
|---|---|
| `id` PK | |
| `customer_id` | FK → `customers`, cascade delete |
| `product_id` | Shopify product GID |
| `created_at` | order of adding |

Unique `(customer_id, product_id)`; index on `customer_id`. Max 200 per customer (enforced in the route).

### `webhook_events` (0002, altered 0004, 0007)
Inbox of every verified Shopify webhook, one row per webhook ID.

| Column | Notes |
|---|---|
| `webhook_id` | unique (`X-Shopify-Webhook-Id`); the dedupe key |
| `topic`, `shop_domain` | |
| `payload` jsonb | full body for catalog topics; `{ id }` for inventory, location and order topics; `{ id, order_id }` for fulfillments; `{ ids }` for fulfillment orders; null for unhandled topics |
| `received_at`, `processed_at`, `failed_at` | state |
| `attempts`, `last_error` | retries |
| `triggered_at`, `api_version` | from Shopify headers (0004) |

Indexes: `(processed_at, failed_at)` for pending work; `received_at` for purge and health (0007).

### `products` (0003)
The catalog read by `/v1/catalog`. `data` jsonb holds the rendered item; other columns exist for filtering and sorting.

| Column | Notes |
|---|---|
| `id` text PK, `handle` unique | |
| `title`, `vendor`, `product_type`, `tags[]`, `available` | |
| `min_price`, `max_price`, `currency`, `on_sale` | |
| `vendor_key`, `type_key`, `gender_keys[]`, `size_keys[]`, `color_key` | normalised filter keys |
| `catalog_position`, `best_selling_rank`, `title_group` | sort keys |
| `data` jsonb, `synced_at` | |

Btree indexes on the filter and sort keys; GIN on `tags`, `gender_keys`, `size_keys`, and a trigram index on `title` for search.

### `product_collections` (0003)
Collection membership and position. PK `(collection_handle, product_id)`; `product_id` FK → `products`, cascade.

### `catalog_state` (0003)
Single row: `last_full_sync_at`, `best_selling_count`.

## Project 3: inventory, orders, fulfillments

### `locations` (0005)
Shopify locations. `shopify_id` unique; `name`, `active`, `fulfills_online_orders`, `updated_at`, `synced_at`.

### `inventory_items` (0005)
One per variant. `shopify_id` unique; `variant_id`, `product_id`, `sku` (indexed), `tracked`.

### `inventory_levels` (0005)
Quantities per item per location.

| Column | Notes |
|---|---|
| `inventory_item_id`, `location_id` | FKs, cascade; unique together |
| `available`, `on_hand`, `committed`, `incoming` | Shopify quantities |
| `shopify_updated_at` | used by `shouldApply` |

### `inventory_level_history` (0005, index changed 0007)
Changes to `available`: `available_before`, `available_after`, `source`, `shopify_updated_at`, `created_at`. FKs are `ON DELETE SET NULL` and the row keeps `item_shopify_id` / `location_shopify_id` as text, so history survives deletes.

### `inventory_state` (0005)
Single row: `last_full_sync_at`.

### `orders` (0006, altered 0007, 0008)
Orders without personal data.

| Column | Notes |
|---|---|
| `shopify_id` unique | |
| `name` | order number (e.g. `#1001`), not a person's name |
| `created_at`, `updated_at`, `processed_at`, `cancelled_at`, `closed_at` | `updated_at` used by `shouldApply` |
| `currency`, `subtotal`, `total`, `tax`, `discount` | |
| `financial_status`, `fulfillment_status`, `cancel_reason`, `source_name`, `test` | |
| `fulfillments_synced_at` | 0008 |

Indexes on `updated_at`, `(created_at desc, shopify_id desc)` for paging, and both statuses.

### `order_lines` (0006, indexes 0007)
`order_id` FK → `orders`, cascade; `shopify_id` unique; `variant_id`, `product_id`, `inventory_item_id`, `sku`, `title`, `quantity`, `fulfillable_quantity`, `unit_price`, `discounted_total`.

### `orders_state` (0006)
Single row: `last_full_sync_at`.

### `fulfillment_orders` (0008)
`shopify_id` unique; `order_id` FK → `orders`; `status`, `request_status`, `assigned_location_shopify_id`, `fulfill_at`, `shopify_updated_at`. No destination, address or contact fields.

### `fulfillment_order_lines` (0008)
`fulfillment_order_id` FK, cascade; `shopify_id` unique; `order_line_shopify_id`, `inventory_item_id`, `total_quantity`, `remaining_quantity`.

### `fulfillments` (0008)
Shipments: `shopify_id` unique; `order_id` FK; `status`, `tracking_company`, `tracking_number`, `tracking_url`, Shopify timestamps.

### `fulfillment_actions` (0008, altered 0009)
One fulfillment request per idempotency key.

| Column | Notes |
|---|---|
| `idempotency_key` unique | |
| `kind`, `fulfillment_order_shopify_id` | |
| `request` jsonb | lines, tracking, notify flag only |
| `dry_run` | |
| `status` | `pending`, `submitting`, `succeeded`, `failed`, `dry_run` |
| `shopify_fulfillment_id`, `attempts`, `last_error` | |
| `created_by_staff_id` | FK → `staff`, set null (0009) |

## Project 3: staff, audit, warehouse

### `staff` (0009)
Staff who have signed in. `email` unique, `google_sub` unique, `role_at_last_login`, `created_at`, `last_login_at`. The live role always comes from `ADMIN_ALLOWLIST`, not this table.

### `audit_log` (0009)
Who did what in the admin API.

| Column | Notes |
|---|---|
| `at`, `completed_at` | |
| `staff_id` (FK, set null), `staff_email`, `role` | |
| `action` | e.g. `auth.login`, `fulfillment.create`, `warehouse.push` |
| `resource_type`, `resource_id` | |
| `result` | `pending`, `success`, `denied`, `rejected`, `error` |
| `status_code`, `request_id` | |
| `detail` jsonb | allowlisted keys and primitive values only |

Indexes on `at desc`, staff, action, and `(resource_type, resource_id)`.

### `warehouse_stock` (0010)
The mock warehouse's own stock. Unique `(sku, location_shopify_id)`; `quantity`, `updated_at`, `updated_by_staff_id` (FK, set null).

### `warehouse_pushes` (0010)
One push per idempotency key: `request` jsonb (skus or all, `allow_large_decrease`, `dry_run`), `dry_run`, `status` (`queued`, `running`, `done`), `item_count`, `created_by_staff_id`, `created_at`, `finished_at`.

### `stock_push_log` (0010)
Every push decision, per item × location × attempt: `push_id` FK (cascade), `inventory_item_shopify_id`, `location_shopify_id`, `sku`, `from_quantity`, `to_quantity` (both `on_hand`), `attempt`, `result` (`pushed`, `dry_run`, `conflict`, `conflict_gave_up`, `skipped_no_change`, `skipped_large_decrease`, `skipped_already_queued`, `skipped_unmapped`, `skipped_not_stocked`, `failed`), `final`, `error`, `created_at`.

### `warehouse_state` (0010)
Single row: `last_reconcile_at`, `differences` (shown on `/health`).

## Personal data by column

| Column | What it holds |
|---|---|
| `customers.customer_id`, `favourites.customer_id` | pseudonymous Shopify customer ID; no name, email or phone |
| `staff.email`, `staff.google_sub`, `audit_log.staff_email` | staff identity (employees, by design) |
| `audit_log.detail.email_hash` | keyed hash of a rejected sign-in email, never the email |
| `webhook_events.payload` | limited by topic (see above); order bodies are never stored |
| `fulfillments.tracking_number`, `tracking_url` | shipment lookup, not a name or address |
| `orders.name` | order number |

No table has a customer name, email, phone, address or note column. See [SECURITY.md](SECURITY.md#personal-data).

## pg-boss (external)

pg-boss creates and migrates its own `pgboss` schema at startup (`backend/src/queue.ts`, pool `max: 3`). The app reads `pgboss.job` and `pgboss.queue` only for `/health` queue stats (`backend/src/db/queue-health.ts`). Queue settings are listed in [RELIABILITY.md](RELIABILITY.md#queues).
