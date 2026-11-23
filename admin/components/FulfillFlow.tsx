"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { fulfillAction, type FulfillState } from "@/app/actions";

type Line = { id: string; title: string; sku: string | null; remaining: number };

/**
 * Fulfill in three steps: choose items → dry run → confirm exactly what will be sent.
 * The confirm form carries a sealed ticket (idempotency key + body) created once per
 * confirm screen, so double clicks or resubmits can't fulfill twice.
 */
export function FulfillFlow({ orderId, foId, lines }: { orderId: string; foId: string; lines: Line[] }) {
  const [state, action, pending] = useActionState<FulfillState, FormData>(fulfillAction, { step: "form" });
  const [notify, setNotify] = useState(false);

  if (state.step === "done") {
    return (
      <div className="card">
        <h2>{state.replayed ? "Already submitted" : "Fulfillment submitted"}</h2>
        <p>
          Status: <strong>{state.action.status}</strong>
          {state.replayed ? " (this confirmation was used before; nothing was sent twice)" : ""}
        </p>
        <p>
          <Link href={`/fulfillments/${encodeURIComponent(state.action.key)}`}>Follow its progress</Link> ·{" "}
          <Link href={`/orders/${orderId}`}>Back to the order</Link>
        </p>
      </div>
    );
  }

  if (state.step === "confirm") {
    return (
      <div className="card">
        <h2>Confirm fulfillment</h2>
        <p>This is exactly what will be sent to Shopify:</p>
        <pre style={{ overflowX: "auto" }}>{JSON.stringify(state.wouldSend, null, 2)}</pre>
        {state.notify ? (
          <p className="error">
            <strong>The customer will be emailed</strong> a shipping notification.
          </p>
        ) : (
          <p className="muted">The customer will not be notified.</p>
        )}
        <form action={action} style={{ display: "flex", gap: 8 }}>
          <input type="hidden" name="ticket" value={state.ticket} />
          <button className="primary" type="submit" name="intent" value="confirm" disabled={pending}>
            {pending ? "Submitting…" : "Confirm and fulfill"}
          </button>
          <button type="submit" name="intent" value="back" disabled={pending}>
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="fo_id" value={foId} />
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>SKU</th>
            <th>Remaining</th>
            <th>Fulfill</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.title}</td>
              <td>{l.sku ?? "—"}</td>
              <td>{l.remaining}</td>
              <td>
                <input type="number" name={`qty:${l.id}`} min={0} max={l.remaining} defaultValue={l.remaining} style={{ width: 80 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Tracking (optional)</h3>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="tracking_company" placeholder="Carrier (e.g. UPS)" maxLength={100} />
        <input name="tracking_number" placeholder="Tracking number" maxLength={100} />
        <input name="tracking_url" placeholder="Tracking URL" maxLength={500} type="url" />
      </p>
      <label style={{ display: "block", margin: "12px 0" }}>
        <input type="checkbox" name="notify_customer" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify customer
      </label>
      {notify ? (
        <p className="error">
          <strong>Warning:</strong> Shopify will email the customer a shipping notification. Leave this unticked for test orders.
        </p>
      ) : null}
      {state.error ? <p className="error">{state.error}</p> : null}
      <button className="primary" type="submit" name="intent" value="preview" disabled={pending}>
        {pending ? "Checking…" : "Review (dry run)"}
      </button>
    </form>
  );
}
