"use client";
import { useActionState, useRef, useState } from "react";
import { syncAction, type SyncState } from "@/app/actions";
import { Button } from "./ui/Button";
import { SyncIcon } from "./ui/Icons";
import { Toast } from "./ui/Toast";

const KINDS = [
  { kind: "orders", label: "Orders", detail: "Re-reads orders from the last 60 days and their fulfillment data." },
  { kind: "inventory", label: "Inventory", detail: "Re-reads every location, inventory item and level." },
  { kind: "catalog", label: "Catalog", detail: "Re-reads all products and collections and refreshes the storefront." },
] as const;

/** Admin only: "Sync" menu in the page header; each sync is confirmed in a dialog. */
export function SyncPanel() {
  const [state, action, pending] = useActionState<SyncState, FormData>(syncAction, {});
  const [kind, setKind] = useState<(typeof KINDS)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [submits, setSubmits] = useState(0);

  const open = (k: (typeof KINDS)[number]) => {
    setKind(k);
    dialog.current?.showModal();
  };

  return (
    <>
      <details className="relative">
        <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg bg-surface px-3 font-semibold shadow-button hover:bg-surface-hover">
          <SyncIcon className="size-4" />
          Sync
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl bg-surface p-1 shadow-xl ring-1 ring-black/5">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => open(k)} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover">
              {k.label}
            </button>
          ))}
        </div>
      </details>
      <dialog ref={dialog} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-surface p-0 text-fg shadow-2xl">
        {kind ? (
          <form
            action={action}
            onSubmit={() => {
              setSubmits((n) => n + 1);
              dialog.current?.close();
            }}
          >
            <div className="border-b border-line px-4 py-3 font-semibold">Run a full {kind.label.toLowerCase()} sync?</div>
            <div className="px-4 py-3 text-subdued">{kind.detail} It runs in the background and is recorded in the audit log.</div>
            <input type="hidden" name="kind" value={kind.kind} />
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button type="button" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                Start sync
              </Button>
            </div>
          </form>
        ) : null}
      </dialog>
      {state.message ? <Toast id={submits} message={state.message} /> : null}
      {state.error ? <p className="w-full text-critical">{state.error}</p> : null}
    </>
  );
}
