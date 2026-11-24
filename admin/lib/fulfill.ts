// Pure fulfill-flow rules (no next/* imports), unit tested.
import { openSealedTicket, sealTicket, TICKET_TTL_SECONDS } from "./ticket";
import type { StaffRole } from "./session";

/** Body for POST /admin/fulfillments (same shape as the backend's schema). */
export type FulfillmentBody = {
  fulfillment_order_id: string;
  lines: { id: string; quantity: number }[];
  tracking?: { company?: string; number?: string; url?: string };
  notify_customer: boolean;
};

export const FULFILLABLE = new Set(["OPEN", "IN_PROGRESS"]);
/** How long a confirm screen stays valid. */
export { TICKET_TTL_SECONDS };

export const canFulfill = (role: StaffRole) => role === "operator" || role === "admin";

export const numericId = (gid: string) => gid.split("/").pop() ?? gid;

/**
 * Builds the request from the form. Quantities must be whole numbers between 0 and what
 * remains; lines left at 0 are left out. Notify is only true when the box was ticked.
 */
export function buildFulfillmentBody(
  form: { get(name: string): FormDataEntryValue | null },
  fulfillmentOrderId: string,
  remaining: { id: string; remainingQuantity: number }[],
): { body: FulfillmentBody } | { error: string } {
  const lines: FulfillmentBody["lines"] = [];
  for (const line of remaining) {
    const raw = String(form.get(`qty:${line.id}`) ?? "0").trim();
    if (!/^\d+$/.test(raw)) return { error: "Quantities must be whole numbers." };
    const quantity = Number(raw);
    if (quantity > line.remainingQuantity) return { error: "A quantity is more than what remains to fulfill." };
    if (quantity > 0) lines.push({ id: line.id, quantity });
  }
  if (lines.length === 0) return { error: "Choose at least one item to fulfill." };

  const text = (name: string) => {
    const v = String(form.get(name) ?? "").trim();
    return v ? v.slice(0, 500) : undefined;
  };
  const company = text("tracking_company");
  const number = text("tracking_number");
  const url = text("tracking_url");
  if (url && !number) return { error: "A tracking URL needs a tracking number." };
  if (url && !/^https?:\/\//i.test(url)) return { error: "The tracking URL must start with http:// or https://." };
  const tracking = company || number || url ? { ...(company ? { company } : {}), ...(number ? { number } : {}), ...(url ? { url } : {}) } : undefined;

  return {
    body: {
      fulfillment_order_id: fulfillmentOrderId,
      lines,
      ...(tracking ? { tracking } : {}),
      notify_customer: form.get("notify_customer") === "on",
    },
  };
}

/** Fulfill confirm screen ticket (see lib/ticket.ts). */
export function createTicket(body: FulfillmentBody, staffId: number, secret: string, nowSeconds: number, key = crypto.randomUUID()): string {
  return sealTicket("fulfill", body, staffId, secret, nowSeconds, key);
}

export function openTicket(ticket: string, staffId: number, secret: string, nowSeconds: number): { key: string; body: FulfillmentBody } | null {
  return openSealedTicket<FulfillmentBody>("fulfill", ticket, staffId, secret, nowSeconds);
}

/** Friendly text for backend refusals (never echoes raw bodies). */
export function describeFailure(status: number, body: unknown): string {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const reasons: Record<string, string> = {
    fulfillment_order_not_found: "That fulfillment order hasn't been synced yet. Try again after the next orders sync.",
    fulfillment_order_not_open: "That fulfillment order is no longer open.",
    unknown_line: "An item doesn't belong to this fulfillment order any more. Reload and try again.",
    quantity_exceeds_remaining: "A quantity is more than what remains. Reload and try again.",
    nothing_to_fulfill: "Nothing remains to fulfill.",
    idempotency_key_reused: "This confirmation was already used for a different request. Start again.",
    audit_unavailable: "The audit log is unavailable, so nothing was done. Try again shortly.",
    fulfillments_not_configured: "Fulfillments aren't configured on the backend.",
    warehouse_not_configured: "Warehouse pushes aren't configured on the backend (Admin API off).",
    nothing_to_push: "Nothing to push: none of the selected rows differ from Shopify any more.",
    unknown_location: "That location isn't known to the backend. Run an inventory sync first.",
    forbidden: "Your role can't do this.",
  };
  if (typeof code === "string" && reasons[code]) return reasons[code];
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (status >= 500) return "The backend had a problem. Nothing to repeat yet; check the order before retrying.";
  return "The request was refused.";
}

export type NavItem = { href: string; label: string };
export function navFor(role: StaffRole): NavItem[] {
  return [
    { href: "/orders", label: "Orders" },
    { href: "/inventory", label: "Inventory" },
    { href: "/warehouse", label: "Warehouse" },
    ...(role === "admin" ? [{ href: "/audit", label: "Audit" }] : []),
  ];
}

export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
