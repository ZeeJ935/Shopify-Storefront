// Pure warehouse page rules (no next/* imports), unit tested.
import type { StaffRole } from "./session";
import type { DiffStatus, PushBody, WarehouseDiffRow } from "./types-warehouse";

export const PUSHABLE: ReadonlySet<DiffStatus> = new Set(["differs", "large_decrease"]);
export const canPush = (role: StaffRole) => role === "operator" || role === "admin";
export const canEditStock = (role: StaffRole) => role === "admin";

/**
 * Push body from the selection form. Only SKUs that are pushable in the (server-read) diff
 * are accepted; "all" sends { all: true }. Flags are true only when their box was ticked.
 */
export function buildPushBody(
  form: { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] },
  rows: WarehouseDiffRow[],
): { body: PushBody } | { error: string } {
  const flags = { allow_large_decrease: form.get("allow_large_decrease") === "on", dry_run: form.get("dry_run") === "on" };
  const pushable = new Set(rows.filter((r) => PUSHABLE.has(r.status)).map((r) => r.sku));
  if (pushable.size === 0) return { error: "Nothing differs from Shopify right now." };
  if (form.get("scope") === "all") return { body: { all: true, ...flags } };
  const skus = [...new Set(form.getAll("sku").map(String))].filter((s) => pushable.has(s)).sort();
  if (skus.length === 0) return { error: "Select at least one row that differs, or choose “All differences”." };
  return { body: { skus, ...flags } };
}

export type ConfirmRow = { sku: string; location: string; from: number; to: number; largeDecrease: boolean; willApply: boolean };

/** What the confirm screen lists, from the server-read diff and the body. */
export function confirmRows(rows: WarehouseDiffRow[], body: PushBody): ConfirmRow[] {
  const wanted = body.skus ? new Set(body.skus) : null;
  return rows
    .filter((r) => PUSHABLE.has(r.status) && r.onHand !== null && (!wanted || wanted.has(r.sku)))
    .map((r) => {
      const largeDecrease = r.status === "large_decrease";
      return { sku: r.sku, location: r.locationName ?? r.locationShopifyId, from: r.onHand!, to: r.warehouseQuantity, largeDecrease, willApply: !largeDecrease || body.allow_large_decrease };
    });
}

export const signed = (n: number | null) => (n === null ? "—" : n > 0 ? `+${n}` : String(n));
