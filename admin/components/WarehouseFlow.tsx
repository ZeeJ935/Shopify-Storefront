"use client";
import { useActionState } from "react";
import { warehouseAction, type WarehouseState } from "@/app/actions";
import { signed } from "@/lib/warehouse";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export const PUSH_FORM_ID = "warehouse-push";

/**
 * Push controls. Row checkboxes live in the table (form="warehouse-push"). The confirm
 * screen carries a sealed ticket (idempotency key created once + exact body), so double
 * clicks can't push twice.
 */
export function WarehouseFlow({ differing }: { differing: number }) {
  const [state, action, pending] = useActionState<WarehouseState, FormData>(warehouseAction, { step: "select" });

  if (state.step === "confirm") {
    const skipped = state.rows.filter((r) => !r.willApply).length;
    return (
      <Card title="Confirm push to Shopify" padded={false}>
        <div className="flex flex-col gap-2 px-4 pb-3">
          {state.dryRun ? (
            <Banner tone="info" title="Dry run">
              {state.mode === "dry_run" ? "The backend is in dry_run mode: " : ""}nothing will be written to Shopify. Each row is logged with the quantity it would set.
            </Banner>
          ) : (
            <Banner tone="warning" title="This writes Shopify on_hand">
              Shopify is re-read for every row at push time. If on_hand changed in the meantime (a sale), that row is not overwritten; it&apos;s retried or reported as a conflict.
            </Banner>
          )}
          {skipped ? (
            <Banner tone="critical" title={`${skipped} large decrease${skipped === 1 ? "" : "s"} will be skipped`}>
              Go back and tick &ldquo;Allow large decreases&rdquo; to apply them.
            </Banner>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-subdued text-xs text-subdued">
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 text-right font-medium">on_hand now</th>
                <th className="px-3 py-2 text-right font-medium">Set to</th>
                <th className="px-4 py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={`${r.sku}|${r.location}`} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">{r.sku}</td>
                  <td className="px-3 py-2 text-subdued">{r.location}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.from}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.to}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{signed(r.to - r.from)}</span>
                      {r.largeDecrease ? <Badge tone={r.willApply ? "warning" : "critical"}>{r.willApply ? "Large decrease, allowed" : "Large decrease, will be skipped"}</Badge> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={action} className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <input type="hidden" name="ticket" value={state.ticket} />
          <Button type="submit" name="intent" value="back" disabled={pending}>
            Back
          </Button>
          <Button type="submit" name="intent" value="confirm" variant="primary" disabled={pending}>
            {pending ? "Pushing…" : state.dryRun ? "Run dry run" : `Push ${state.rows.length - skipped} row${state.rows.length - skipped === 1 ? "" : "s"}`}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <form id={PUSH_FORM_ID} action={action} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface px-4 py-3 shadow-card">
      <fieldset className="flex items-center gap-3">
        <legend className="sr-only">Rows to push</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="scope" value="selected" defaultChecked className="accent-[var(--primary)]" /> Selected rows
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="scope" value="all" className="accent-[var(--primary)]" /> All differences ({differing})
        </label>
      </fieldset>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="dry_run" className="accent-[var(--primary)]" /> Dry run only
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="allow_large_decrease" className="accent-[var(--primary)]" /> Allow large decreases
      </label>
      <div className="ml-auto flex items-center gap-2">
        {state.error ? <span className="text-critical">{state.error}</span> : null}
        <Button type="submit" name="intent" value="preview" variant="primary" disabled={pending || differing === 0}>
          {pending ? "Checking…" : "Review push"}
        </Button>
      </div>
    </form>
  );
}
