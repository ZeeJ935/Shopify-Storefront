import type pg from "pg";
import { errorText } from "../db/webhooks.js";
import type { ReportError } from "../report.js";
import type { WarehouseAdapter } from "./adapter.js";
import { PUSHABLE, warehouseDiff } from "./diff.js";
import type { WarehouseEnv } from "./env.js";
import { pushIdempotencyKey, type StockShopify } from "./shopify.js";

/** Conflict retries after the first attempt (so up to 4 attempts per location). */
export const MAX_CONFLICT_RETRIES = 3;
export const MAX_PUSH_SKUS = 500;

export type PushRequest = { skus: string[] | null; all: boolean; allowLargeDecrease: boolean; dryRun: boolean };

export type PushView = {
  key: string;
  status: "queued" | "running" | "done";
  dryRun: boolean;
  itemCount: number;
  request: PushRequest;
  createdAt: string;
  finishedAt: string | null;
};

export type PushLogRow = {
  inventoryItemId: string;
  locationId: string | null;
  sku: string | null;
  from: number | null;
  to: number | null;
  attempt: number;
  result: string;
  final: boolean;
  error: string | null;
  at: string;
};

export class ItemBusyError extends Error {
  constructor() {
    super("another push for this inventory item is running");
    this.name = "ItemBusyError";
  }
}

/** Enqueue one item job on the caller's transaction; resolves null when one is already queued (stately). */
export type EnqueueItem = (client: pg.PoolClient, data: { pushId: number; itemGid: string }) => Promise<string | null>;

type PushRow = {
  id: string;
  idempotency_key: string;
  status: PushView["status"];
  dry_run: boolean;
  item_count: number;
  request: PushRequest;
  created_at: Date;
  finished_at: Date | null;
};
const COLUMNS = "id, idempotency_key, status, dry_run, item_count, request, created_at, finished_at";
const view = (r: PushRow): PushView => ({
  key: r.idempotency_key,
  status: r.status,
  dryRun: r.dry_run,
  itemCount: r.item_count,
  request: r.request,
  createdAt: r.created_at.toISOString(),
  finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
});

async function log(
  db: pg.Pool | pg.PoolClient,
  row: { pushId: number; itemGid: string; locationGid: string | null; sku: string | null; from?: number | null; to?: number | null; attempt?: number; result: string; final?: boolean; error?: string | null },
) {
  await db.query(
    `insert into stock_push_log (push_id, inventory_item_shopify_id, location_shopify_id, sku, from_quantity, to_quantity, attempt, result, final, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [row.pushId, row.itemGid, row.locationGid, row.sku, row.from ?? null, row.to ?? null, row.attempt ?? 1, row.result, row.final ?? false, row.error ?? null],
  );
}

/** Marks the push done once every item has its final log row. */
export async function finishIfDone(db: pg.Pool | pg.PoolClient, pushId: number) {
  await db.query(
    `update warehouse_pushes p set status = 'done', finished_at = now()
     where p.id = $1 and p.status <> 'done'
       and (select count(distinct inventory_item_shopify_id) from stock_push_log l where l.push_id = p.id and l.final) >= p.item_count`,
    [pushId],
  );
}

export type CreatePushResult =
  | { kind: "created"; push: PushView }
  | { kind: "replayed"; push: PushView }
  | { kind: "key_reused" }
  | { kind: "nothing_to_push" };

/**
 * Records a push once per idempotency key and queues one job per inventory item (in the
 * same transaction). An item that already has a queued job gets a final
 * "skipped_already_queued" row so the push can still finish.
 */
export async function createPush(
  pool: pg.Pool,
  deps: { adapter: WarehouseAdapter; env: WarehouseEnv; enqueue: EnqueueItem },
  input: { key: string; request: PushRequest; staffId: number | null },
): Promise<CreatePushResult> {
  const requestJson = JSON.stringify(input.request);
  const existing = await pool.query<PushRow & { same: boolean }>(`select ${COLUMNS}, request = $2::jsonb as same from warehouse_pushes where idempotency_key = $1`, [input.key, requestJson]);
  if (existing.rows[0]) return existing.rows[0].same ? { kind: "replayed", push: view(existing.rows[0]) } : { kind: "key_reused" };

  const wanted = input.request.skus ? new Set(input.request.skus) : null;
  const rows = (await warehouseDiff(deps.adapter, pool, { maxDecrease: deps.env.maxDecrease })).filter(
    (r) => PUSHABLE.has(r.status) && r.inventoryItemShopifyId && (!wanted || wanted.has(r.sku)),
  );
  const items = [...new Map(rows.map((r) => [r.inventoryItemShopifyId!, r.sku])).entries()];
  if (items.length === 0) return { kind: "nothing_to_push" };

  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<PushRow>(
      `insert into warehouse_pushes (idempotency_key, request, dry_run, status, item_count, created_by_staff_id)
       values ($1, $2::jsonb, $3, 'queued', $4, $5) on conflict (idempotency_key) do nothing returning ${COLUMNS}`,
      [input.key, requestJson, input.request.dryRun, items.length, input.staffId],
    );
    if (!inserted.rows[0]) {
      // A concurrent request with this key committed first.
      await client.query("rollback");
      const again = await pool.query<PushRow & { same: boolean }>(`select ${COLUMNS}, request = $2::jsonb as same from warehouse_pushes where idempotency_key = $1`, [input.key, requestJson]);
      return again.rows[0].same ? { kind: "replayed", push: view(again.rows[0]) } : { kind: "key_reused" };
    }
    const pushId = Number(inserted.rows[0].id);
    for (const [itemGid, sku] of items) {
      const jobId = await deps.enqueue(client, { pushId, itemGid });
      if (!jobId) await log(client, { pushId, itemGid, locationGid: null, sku, result: "skipped_already_queued", final: true });
    }
    await finishIfDone(client, pushId);
    const final = await client.query<PushRow>(`select ${COLUMNS} from warehouse_pushes where id = $1`, [pushId]);
    await client.query("commit");
    return { kind: "created", push: view(final.rows[0]) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getPush(pool: pg.Pool, key: string): Promise<{ push: PushView; log: PushLogRow[] } | null> {
  const { rows } = await pool.query<PushRow>(`select ${COLUMNS} from warehouse_pushes where idempotency_key = $1`, [key]);
  if (!rows[0]) return null;
  const logRows = await pool.query<{
    inventory_item_shopify_id: string;
    location_shopify_id: string | null;
    sku: string | null;
    from_quantity: number | null;
    to_quantity: number | null;
    attempt: number;
    result: string;
    final: boolean;
    error: string | null;
    created_at: Date;
  }>(`select * from stock_push_log where push_id = $1 order by id`, [rows[0].id]);
  return {
    push: view(rows[0]),
    log: logRows.rows.map((l) => ({
      inventoryItemId: l.inventory_item_shopify_id,
      locationId: l.location_shopify_id,
      sku: l.sku,
      from: l.from_quantity,
      to: l.to_quantity,
      attempt: l.attempt,
      result: l.result,
      final: l.final,
      error: l.error,
      at: l.created_at.toISOString(),
    })),
  };
}

export type RunItemDeps = {
  pool: pg.Pool;
  adapter: WarehouseAdapter;
  shopify: StockShopify;
  env: WarehouseEnv;
  /** Re-fetch and store the level after a successful set (errors are reported, not thrown). */
  refreshLevel?: (itemGid: string, locationGid: string) => Promise<unknown>;
  report?: ReportError;
};

export type RunItemResult = "skipped" | "processed";

/**
 * One inventory item for one push (pg-boss job body). Per location: read Shopify's LIVE
 * on_hand, compare with the warehouse quantity (read now), apply the guards, then
 * compare-and-set on_hand. A stale compare (a sale happened) is never overwritten: log a
 * conflict, re-read and retry up to MAX_CONFLICT_RETRIES times.
 */
export async function runPushItem(deps: RunItemDeps, data: { pushId: number; itemGid: string }): Promise<RunItemResult> {
  const { pushId, itemGid } = data;
  // Second guard next to the stately queue: one worker per item, whatever happens.
  const lock = await deps.pool.connect();
  try {
    const got = await lock.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as ok", [`warehouse-item:${itemGid}`]);
    if (!got.rows[0].ok) throw new ItemBusyError();
    try {
      return await processItem(deps, pushId, itemGid);
    } finally {
      await lock.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`warehouse-item:${itemGid}`]);
    }
  } finally {
    lock.release();
  }
}

async function processItem(deps: RunItemDeps, pushId: number, itemGid: string): Promise<RunItemResult> {
  const { pool } = deps;
  const push = await pool.query<{ status: string; dry_run: boolean; request: PushRequest }>("select status, dry_run, request from warehouse_pushes where id = $1", [pushId]);
  const p = push.rows[0];
  if (!p || p.status === "done") return "skipped";
  const already = await pool.query("select 1 from stock_push_log where push_id = $1 and inventory_item_shopify_id = $2 and final limit 1", [pushId, itemGid]);
  if (already.rowCount) return "skipped"; // a re-delivered job
  await pool.query("update warehouse_pushes set status = 'running' where id = $1 and status = 'queued'", [pushId]);

  const dryRun = p.dry_run || deps.env.pushMode === "dry_run";
  const items = await pool.query<{ sku: string | null; n: string }>(
    "select ii.sku, (select count(*) from inventory_items x where x.sku = ii.sku)::text as n from inventory_items ii where ii.shopify_id = $1",
    [itemGid],
  );
  const sku = items.rows[0]?.sku ?? null;
  const outcomes: { id: number }[] = [];
  const write = async (row: Parameters<typeof log>[1]) => {
    const r = await pool.query<{ id: string }>(
      `insert into stock_push_log (push_id, inventory_item_shopify_id, location_shopify_id, sku, from_quantity, to_quantity, attempt, result, final, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, false, $9) returning id`,
      [row.pushId, row.itemGid, row.locationGid, row.sku, row.from ?? null, row.to ?? null, row.attempt ?? 1, row.result, row.error ?? null],
    );
    outcomes.push({ id: Number(r.rows[0].id) });
  };

  const stock = sku && Number(items.rows[0].n) === 1 ? await deps.adapter.getStock(sku) : [];
  if (stock.length === 0) await write({ pushId, itemGid, locationGid: null, sku, result: "skipped_unmapped" });

  for (const row of stock) {
    const loc = row.locationShopifyId;
    const to = row.quantity;
    for (let attempt = 1; ; attempt++) {
      const live = await deps.shopify.liveLevel(itemGid, loc);
      if (!live) {
        await write({ pushId, itemGid, locationGid: loc, sku, to, attempt, result: "skipped_not_stocked" });
        break;
      }
      const from = live.onHand;
      const base = { pushId, itemGid, locationGid: loc, sku, from, to, attempt };
      if (to === from) {
        await write({ ...base, result: "skipped_no_change" });
        break;
      }
      if (to - from < -deps.env.maxDecrease && !p.request.allowLargeDecrease) {
        await write({ ...base, result: "skipped_large_decrease" });
        break;
      }
      if (dryRun) {
        await write({ ...base, result: "dry_run" });
        break;
      }
      const result = await deps.shopify.setOnHand({
        itemGid,
        locationGid: loc,
        quantity: to,
        changeFromQuantity: from,
        idempotencyKey: pushIdempotencyKey({ pushId, itemGid, locationGid: loc, attempt, from }),
        referenceDocumentUri: `gid://zj-backend/WarehousePush/${pushId}`,
      });
      if (result === "ok") {
        await write({ ...base, result: "pushed" });
        try {
          await deps.refreshLevel?.(itemGid, loc);
        } catch (error) {
          deps.report?.(error, { kind: "job", job: "warehouse-push", step: "refresh_level" });
        }
        break;
      }
      // Stale: Shopify's on_hand changed since we read it. Shopify was NOT changed.
      if (attempt > MAX_CONFLICT_RETRIES) {
        await write({ ...base, result: "conflict_gave_up", error: "on_hand kept changing; not overwritten" });
        deps.report?.(new Error("warehouse push gave up after repeated conflicts"), { kind: "job", job: "warehouse-push", result: "conflict_gave_up" });
        break;
      }
      await write({ ...base, result: "conflict", error: "on_hand changed since it was read; re-reading" });
    }
  }

  // The last row for this item closes it for the push.
  await pool.query("update stock_push_log set final = true where id = $1", [outcomes[outcomes.length - 1].id]);
  await finishIfDone(pool, pushId);
  return "processed";
}

/** Called by the job after its last failed attempt: closes the item so the push can finish. */
export async function failPushItem(pool: pg.Pool, data: { pushId: number; itemGid: string }, error: unknown) {
  const done = await pool.query("select 1 from stock_push_log where push_id = $1 and inventory_item_shopify_id = $2 and final limit 1", [data.pushId, data.itemGid]);
  if (!done.rowCount) await log(pool, { pushId: data.pushId, itemGid: data.itemGid, locationGid: null, sku: null, result: "failed", final: true, error: errorText(error) });
  await finishIfDone(pool, data.pushId);
}
