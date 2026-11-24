"use server";
// Every action re-checks the session and role on the server (forms are not a security
// boundary), and the backend checks the role again and audits the change.
import { BackendError } from "@/lib/backend";
import { readConfig } from "@/lib/env";
import { buildFulfillmentBody, createTicket, describeFailure, FULFILLABLE, openTicket } from "@/lib/fulfill";
import { redirect } from "next/navigation";
import { requireSession, staffFetch } from "@/lib/session-server";
import { openSealedTicket, sealTicket } from "@/lib/ticket";
import type { PushBody, WarehouseDiff } from "@/lib/types-warehouse";
import { buildPushBody, confirmRows, type ConfirmRow } from "@/lib/warehouse";
import type { FulfillmentAction, OrderDetail, WouldSend } from "@/lib/types";

export type FulfillState =
  | { step: "form"; error?: string }
  | { step: "confirm"; wouldSend: WouldSend; ticket: string; notify: boolean }
  | { step: "done"; action: FulfillmentAction; replayed: boolean };

const ID = /^\d{1,20}$/;
const now = () => Math.floor(Date.now() / 1000);

export async function fulfillAction(_prev: FulfillState, form: FormData): Promise<FulfillState> {
  const session = await requireSession("operator");
  const intent = form.get("intent");
  if (intent === "back") return { step: "form" };

  if (intent === "preview") {
    const orderId = String(form.get("order_id") ?? "");
    const foId = String(form.get("fo_id") ?? "");
    if (!ID.test(orderId) || !ID.test(foId)) return { step: "form", error: "Invalid order." };
    // Remaining quantities come from the backend, never from the browser.
    const order = await staffFetch<OrderDetail>(`/admin/orders/${orderId}`);
    const fo = order.fulfillmentOrders.find((f) => f.id === `gid://shopify/FulfillmentOrder/${foId}`);
    if (!fo || !FULFILLABLE.has(fo.status)) return { step: "form", error: "That fulfillment order is no longer open." };
    const built = buildFulfillmentBody(form, fo.id, fo.lines);
    if ("error" in built) return { step: "form", error: built.error };
    try {
      const dry = await staffFetch<{ wouldSend: WouldSend }>("/admin/fulfillments", {
        method: "POST",
        body: { ...built.body, dry_run: true },
        idempotencyKey: `dry-${crypto.randomUUID()}`,
      });
      // The real key is created once, here, and sealed with the exact body.
      const ticket = createTicket(built.body, session.staff.id, readConfig().sessionSecret, now());
      return { step: "confirm", wouldSend: dry.wouldSend, ticket, notify: built.body.notify_customer };
    } catch (error) {
      if (error instanceof BackendError) return { step: "form", error: describeFailure(error.status, error.body) };
      throw error;
    }
  }

  if (intent === "confirm") {
    const opened = openTicket(String(form.get("ticket") ?? ""), session.staff.id, readConfig().sessionSecret, now());
    if (!opened) return { step: "form", error: "This confirmation expired. Review the fulfillment again." };
    try {
      const result = await staffFetch<{ action: FulfillmentAction; replayed?: boolean }>("/admin/fulfillments", {
        method: "POST",
        body: opened.body,
        idempotencyKey: opened.key,
      });
      return { step: "done", action: result.action, replayed: Boolean(result.replayed) };
    } catch (error) {
      if (error instanceof BackendError) return { step: "form", error: describeFailure(error.status, error.body) };
      throw error;
    }
  }
  return { step: "form", error: "Unknown request." };
}

export type SyncState = { message?: string; error?: string };
const SYNC_KINDS = new Set(["catalog", "inventory", "orders"]);

export async function syncAction(_prev: SyncState, form: FormData): Promise<SyncState> {
  await requireSession("admin");
  const kind = String(form.get("kind") ?? "");
  if (!SYNC_KINDS.has(kind)) return { error: "Unknown sync." };
  try {
    await staffFetch(`/admin/sync/${kind}`, { method: "POST" });
    return { message: `A full ${kind} sync was queued.` };
  } catch (error) {
    if (error instanceof BackendError) return { error: describeFailure(error.status, error.body) };
    throw error;
  }
}

// ---- Warehouse ----

export type WarehouseState =
  | { step: "select"; error?: string }
  | { step: "confirm"; rows: ConfirmRow[]; ticket: string; dryRun: boolean; mode: "dry_run" | "live"; allowLargeDecrease: boolean };

/** Select → confirm (from a diff re-read on the server) → push. Operator+ (the backend checks again). */
export async function warehouseAction(_prev: WarehouseState, form: FormData): Promise<WarehouseState> {
  const session = await requireSession("operator");
  const intent = form.get("intent");
  if (intent === "back") return { step: "select" };

  if (intent === "preview") {
    const diff = await staffFetch<WarehouseDiff>("/admin/warehouse/diff");
    const built = buildPushBody(form, diff.rows);
    if ("error" in built) return { step: "select", error: built.error };
    const rows = confirmRows(diff.rows, built.body);
    if (rows.length === 0) return { step: "select", error: "Nothing to push for that selection." };
    // The idempotency key is created once, here, and sealed with the exact body.
    const ticket = sealTicket("warehouse-push", built.body, session.staff.id, readConfig().sessionSecret, now());
    return { step: "confirm", rows, ticket, dryRun: built.body.dry_run || diff.mode === "dry_run", mode: diff.mode, allowLargeDecrease: built.body.allow_large_decrease };
  }

  if (intent === "confirm") {
    const opened = openSealedTicket<PushBody>("warehouse-push", String(form.get("ticket") ?? ""), session.staff.id, readConfig().sessionSecret, now());
    if (!opened) return { step: "select", error: "This confirmation expired. Review the push again." };
    let failure: string | null = null;
    try {
      await staffFetch("/admin/warehouse/push", { method: "POST", body: opened.body, idempotencyKey: opened.key });
    } catch (error) {
      if (error instanceof BackendError) failure = describeFailure(error.status, error.body);
      else throw error;
    }
    if (failure) return { step: "select", error: failure };
    redirect(`/warehouse/pushes/${encodeURIComponent(opened.key)}`); // outside try: redirect throws
  }
  return { step: "select", error: "Unknown request." };
}

export type StockState = { message?: string; error?: string; at?: number };
const SKU = /^[^\s].{0,99}$/;

/** Edit mock warehouse stock. Admin only (the backend checks and audits too). */
export async function stockAction(_prev: StockState, form: FormData): Promise<StockState> {
  await requireSession("admin");
  const sku = String(form.get("sku") ?? "").trim();
  const location = String(form.get("location_id") ?? "").trim();
  const raw = String(form.get("quantity") ?? "").trim();
  if (!SKU.test(sku)) return { error: "Enter a SKU.", at: Date.now() };
  if (!/^\d{1,7}$/.test(raw) || Number(raw) > 1_000_000) return { error: "Quantity must be a whole number from 0 to 1,000,000.", at: Date.now() };
  if (!/^(\d{1,20}|gid:\/\/shopify\/Location\/\d{1,20})$/.test(location)) return { error: "Choose a location.", at: Date.now() };
  try {
    await staffFetch("/admin/warehouse/stock", { method: "PUT", body: { sku, location_id: location, quantity: Number(raw) } });
  } catch (error) {
    if (error instanceof BackendError) return { error: describeFailure(error.status, error.body), at: Date.now() };
    throw error;
  }
  return { message: `Warehouse stock for ${sku} set to ${raw}.`, at: Date.now() };
}
