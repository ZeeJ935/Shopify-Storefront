"use client";
import { useActionState, useState } from "react";
import { syncAction, type SyncState } from "@/app/actions";

const KINDS = ["catalog", "inventory", "orders"] as const;

/** Admin only. Each sync needs a second click to confirm. */
export function SyncPanel() {
  const [state, action, pending] = useActionState<SyncState, FormData>(syncAction, {});
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <div className="card">
      <h2>Full syncs</h2>
      <p className="muted">Queues a full re-sync from Shopify. Each run is recorded in the audit log.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {KINDS.map((kind) =>
          armed === kind ? (
            <form key={kind} action={action} onSubmit={() => setArmed(null)}>
              <input type="hidden" name="kind" value={kind} />
              <button className="primary" type="submit" disabled={pending}>
                Confirm {kind} sync
              </button>
            </form>
          ) : (
            <button key={kind} type="button" onClick={() => setArmed(kind)} disabled={pending}>
              Sync {kind}…
            </button>
          ),
        )}
      </div>
      {state.message ? <p>{state.message}</p> : null}
      {state.error ? <p className="error">{state.error}</p> : null}
    </div>
  );
}
