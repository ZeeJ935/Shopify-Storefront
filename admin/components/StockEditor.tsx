"use client";
import { useActionState } from "react";
import { stockAction, type StockState } from "@/app/actions";
import { Button } from "./ui/Button";
import { inputBase } from "./ui/Field";
import { Toast } from "./ui/Toast";

/** Admin only: inline edit of the mock warehouse quantity for one row. */
export function StockEditor({ sku, locationId, quantity }: { sku: string; locationId: string; quantity: number }) {
  const [state, action, pending] = useActionState<StockState, FormData>(stockAction, {});
  return (
    <form action={action} className="flex items-center justify-end gap-1.5">
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="location_id" value={locationId} />
      <label className="sr-only" htmlFor={`qty-${sku}-${locationId}`}>
        Warehouse quantity for {sku}
      </label>
      <input id={`qty-${sku}-${locationId}`} name="quantity" type="number" min={0} max={1000000} defaultValue={quantity} className={`${inputBase} w-20 text-right`} />
      <Button type="submit" size="slim" disabled={pending}>
        Save
      </Button>
      {state.message ? <Toast id={state.at ?? 0} message={state.message} /> : null}
      {state.error ? <span className="text-xs text-critical">{state.error}</span> : null}
    </form>
  );
}

/** Admin only: add a SKU to the mock warehouse. */
export function AddStockForm({ locations }: { locations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<StockState, FormData>(stockAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input name="sku" placeholder="SKU" aria-label="SKU" maxLength={100} className={`${inputBase} w-40`} />
      <select name="location_id" aria-label="Location" className={`${inputBase} w-44`} defaultValue={locations[0]?.id ?? ""}>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <input name="quantity" type="number" min={0} max={1000000} placeholder="Quantity" aria-label="Quantity" className={`${inputBase} w-28`} />
      <Button type="submit" disabled={pending}>
        Add / set stock
      </Button>
      {state.message ? <Toast id={state.at ?? 0} message={state.message} /> : null}
      {state.error ? <span className="text-critical">{state.error}</span> : null}
    </form>
  );
}
