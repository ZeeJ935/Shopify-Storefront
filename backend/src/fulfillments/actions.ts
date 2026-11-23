import type pg from "pg";
import { errorText } from "../db/webhooks.js";
import { ShopifyUserErrors } from "../shopify-admin/index.js";
import type { FulfillmentActionsShopify, FulfillmentCreateInput } from "./actions-admin.js";

/** Fulfillment order statuses that can still be fulfilled. */
export const FULFILLABLE_STATUSES: ReadonlySet<string> = new Set(["OPEN", "IN_PROGRESS"]);

/**
 * A retry that finds the action still "submitting" may follow an attempt that reached
 * Shopify. A fulfillment on the same fulfillment order created since then (minus this
 * clock slack) is adopted instead of sending again.
 */
export const RECONCILE_SLACK_MS = 60_000;

/** Normalized request snapshot (stored as jsonb; compared for idempotent replays). */
export type FulfillmentRequest = {
  fulfillmentOrderId: string;
  /** Null = fulfill everything remaining. Sorted by id. */
  lines: { id: string; quantity: number }[] | null;
  tracking: { company?: string; number?: string; url?: string } | null;
  notifyCustomer: boolean;
};

export type ActionStatus = "pending" | "submitting" | "succeeded" | "failed" | "dry_run";

export type ActionView = {
  key: string;
  status: ActionStatus;
  dryRun: boolean;
  fulfillmentOrderId: string;
  request: FulfillmentRequest;
  shopifyFulfillmentId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type ActionRow = {
  id: string;
  idempotency_key: string;
  status: ActionStatus;
  dry_run: boolean;
  fulfillment_order_shopify_id: string;
  request: FulfillmentRequest;
  shopify_fulfillment_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

function view(r: ActionRow): ActionView {
  return {
    key: r.idempotency_key,
    status: r.status,
    dryRun: r.dry_run,
    fulfillmentOrderId: r.fulfillment_order_shopify_id,
    request: r.request,
    shopifyFulfillmentId: r.shopify_fulfillment_id,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** The exact fulfillmentCreate input a request produces. */
export function toCreateInput(req: FulfillmentRequest): FulfillmentCreateInput {
  return {
    lineItemsByFulfillmentOrder: [
      {
        fulfillmentOrderId: req.fulfillmentOrderId,
        ...(req.lines ? { fulfillmentOrderLineItems: req.lines.map((l) => ({ id: l.id, quantity: l.quantity })) } : {}),
      },
    ],
    notifyCustomer: req.notifyCustomer,
    ...(req.tracking ? { trackingInfo: req.tracking } : {}),
  };
}

export type CheckFailure =
  | "fulfillment_order_not_found"
  | "fulfillment_order_not_open"
  | "unknown_line"
  | "quantity_exceeds_remaining"
  | "nothing_to_fulfill";

/** Checks a request against fulfillment order status + remaining quantities. Null = OK. */
export function checkQuantities(
  fo: { status: string; remaining: Map<string, number> } | null,
  lines: FulfillmentRequest["lines"],
): CheckFailure | null {
  if (!fo) return "fulfillment_order_not_found";
  if (!FULFILLABLE_STATUSES.has(fo.status)) return "fulfillment_order_not_open";
  if (!lines) return [...fo.remaining.values()].some((q) => q > 0) ? null : "nothing_to_fulfill";
  for (const line of lines) {
    const left = fo.remaining.get(line.id);
    if (left === undefined) return "unknown_line";
    if (line.quantity > left) return "quantity_exceeds_remaining";
  }
  return null;
}

export type CreateActionResult =
  | { kind: "created"; action: ActionView; wouldSend?: FulfillmentCreateInput }
  | { kind: "replayed"; action: ActionView; wouldSend?: FulfillmentCreateInput }
  | { kind: "key_reused" }
  | { kind: "rejected"; reason: CheckFailure };

export type EnqueueActionOnClient = (client: pg.PoolClient, actionId: number) => Promise<void>;

const ACTION_COLUMNS = `id, idempotency_key, status, dry_run, fulfillment_order_shopify_id, request,
  shopify_fulfillment_id, attempts, last_error, created_at, updated_at`;

/** Fulfillment order status + remaining quantities from Postgres (synced data). */
async function localFulfillmentOrder(client: pg.PoolClient, foId: string) {
  const fo = await client.query<{ id: string; status: string }>("select id, status from fulfillment_orders where shopify_id = $1", [foId]);
  if (!fo.rows[0]) return null;
  const lines = await client.query<{ shopify_id: string; remaining_quantity: number }>(
    "select shopify_id, remaining_quantity from fulfillment_order_lines where fulfillment_order_id = $1",
    [fo.rows[0].id],
  );
  return { status: fo.rows[0].status, remaining: new Map(lines.rows.map((l) => [l.shopify_id, l.remaining_quantity])) };
}

/**
 * Records a fulfillment request once per idempotency key.
 * - Same key + same request: the existing action is returned (no second job).
 * - Same key + different request: key_reused.
 * - New key: checked against synced data, then saved as dry_run (no Shopify call, no
 *   job) or pending with its job queued in the same transaction.
 */
export async function createFulfillmentAction(
  pool: pg.Pool,
  enqueue: EnqueueActionOnClient | undefined,
  input: { key: string; request: FulfillmentRequest; dryRun: boolean },
): Promise<CreateActionResult> {
  const requestJson = JSON.stringify(input.request);
  const client = await pool.connect();
  try {
    await client.query("begin");

    const replay = async (): Promise<CreateActionResult> => {
      const { rows } = await client.query<ActionRow & { same: boolean }>(
        `select ${ACTION_COLUMNS}, (request = $2::jsonb and dry_run = $3) as same
         from fulfillment_actions where idempotency_key = $1`,
        [input.key, requestJson, input.dryRun],
      );
      const row = rows[0];
      if (!row.same) return { kind: "key_reused" };
      return { kind: "replayed", action: view(row), ...(row.dry_run ? { wouldSend: toCreateInput(row.request) } : {}) };
    };

    // An existing key wins over checks: a replay after the fulfillment succeeded must not 422.
    const existing = await client.query("select 1 from fulfillment_actions where idempotency_key = $1", [input.key]);
    if (existing.rowCount) {
      const result = await replay();
      await client.query("commit");
      return result;
    }

    const failure = checkQuantities(await localFulfillmentOrder(client, input.request.fulfillmentOrderId), input.request.lines);
    if (failure) {
      await client.query("commit");
      return { kind: "rejected", reason: failure };
    }

    const inserted = await client.query<ActionRow>(
      `insert into fulfillment_actions (idempotency_key, kind, fulfillment_order_shopify_id, request, dry_run, status)
       values ($1, 'create', $2, $3::jsonb, $4, $5)
       on conflict (idempotency_key) do nothing
       returning ${ACTION_COLUMNS}`,
      [input.key, input.request.fulfillmentOrderId, requestJson, input.dryRun, input.dryRun ? "dry_run" : "pending"],
    );
    if (!inserted.rows[0]) {
      // A concurrent request with the same key committed first (this insert waited for it).
      const result = await replay();
      await client.query("commit");
      return result;
    }
    const row = inserted.rows[0];
    if (!input.dryRun) {
      if (!enqueue) throw new Error("fulfillment job queue is not configured");
      await enqueue(client, Number(row.id));
    }
    await client.query("commit");
    return { kind: "created", action: view(row), ...(input.dryRun ? { wouldSend: toCreateInput(input.request) } : {}) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getFulfillmentAction(pool: pg.Pool, key: string): Promise<ActionView | null> {
  const { rows } = await pool.query<ActionRow>(`select ${ACTION_COLUMNS} from fulfillment_actions where idempotency_key = $1`, [key]);
  return rows[0] ? view(rows[0]) : null;
}

/** Marks an action failed (final) — used by the job after its last retry. */
export async function markFulfillmentActionFailed(pool: pg.Pool, actionId: number, error: unknown): Promise<void> {
  await pool.query(
    `update fulfillment_actions set status = 'failed', last_error = $2, updated_at = now()
     where id = $1 and status in ('pending', 'submitting')`,
    [actionId, errorText(error)],
  );
}

export type RunActionDeps = {
  pool: pg.Pool;
  shopify: FulfillmentActionsShopify;
  /** Refreshes the order's fulfillment data after a success (errors are reported, not thrown). */
  refreshOrder?: (orderGid: string) => Promise<unknown>;
  onRefreshError?: (error: unknown) => void;
};

export type RunActionResult = "skipped" | "succeeded" | "reconciled" | "failed";

/**
 * Job body for one action. Throws on transient errors so the queue retries
 * (the action stays "submitting"); userErrors or a live check failure are final.
 */
export async function runFulfillmentAction(deps: RunActionDeps, actionId: number): Promise<RunActionResult> {
  const claimed = await deps.pool.query<{
    fulfillment_order_shopify_id: string;
    request: FulfillmentRequest;
    prev_status: ActionStatus;
    prev_updated_at: Date;
  }>(
    `with prev as (
       select id, status, updated_at from fulfillment_actions
       where id = $1 and status in ('pending', 'submitting') for update
     )
     update fulfillment_actions a set status = 'submitting', attempts = a.attempts + 1, updated_at = now()
     from prev where a.id = prev.id
     returning a.fulfillment_order_shopify_id, a.request, prev.status as prev_status, prev.updated_at as prev_updated_at`,
    [actionId],
  );
  const action = claimed.rows[0];
  if (!action) return "skipped"; // done, failed, dry run, or missing

  const finish = async (status: "succeeded" | "failed", fields: { fulfillmentId?: string; error?: string }) => {
    await deps.pool.query(
      `update fulfillment_actions set status = $2, shopify_fulfillment_id = coalesce($3, shopify_fulfillment_id),
         last_error = $4, updated_at = now() where id = $1`,
      [actionId, status, fields.fulfillmentId ?? null, fields.error ?? null],
    );
  };
  const refresh = async (orderGid: string) => {
    try {
      await deps.refreshOrder?.(orderGid);
    } catch (error) {
      deps.onRefreshError?.(error);
    }
  };

  try {
    const live = await deps.shopify.liveFulfillmentOrder(action.fulfillment_order_shopify_id);

    if (live && action.prev_status === "submitting") {
      const since = action.prev_updated_at.getTime() - RECONCILE_SLACK_MS;
      const match = live.recentFulfillments.find((f) => Date.parse(f.createdAt) >= since);
      if (match) {
        await finish("succeeded", { fulfillmentId: match.id, error: "reconciled: adopted fulfillment created by an earlier attempt" });
        await refresh(live.orderId);
        return "reconciled";
      }
    }

    const failure = checkQuantities(live, action.request.lines);
    if (failure) {
      await finish("failed", { error: `live check failed: ${failure}` });
      return "failed";
    }

    const created = await deps.shopify.createFulfillment(toCreateInput(action.request));
    await finish("succeeded", { fulfillmentId: created.id });
    await refresh(live!.orderId);
    return "succeeded";
  } catch (error) {
    if (error instanceof ShopifyUserErrors) {
      await finish("failed", { error: errorText(error) });
      return "failed";
    }
    // Transient: keep "submitting" (the retry reconciles first) and record why.
    await deps.pool.query("update fulfillment_actions set last_error = $2, updated_at = updated_at where id = $1", [
      actionId,
      errorText(error),
    ]);
    throw error;
  }
}
