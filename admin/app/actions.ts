"use server";
// Every action re-checks the session and role on the server (forms are not a security
// boundary), and the backend checks the role again and audits the change.
import { BackendError } from "@/lib/backend";
import { readConfig } from "@/lib/env";
import { buildFulfillmentBody, createTicket, describeFailure, FULFILLABLE, openTicket } from "@/lib/fulfill";
import { requireSession, staffFetch } from "@/lib/session-server";
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
