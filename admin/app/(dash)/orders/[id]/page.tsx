import Link from "next/link";
import { canFulfill, formatDate, formatMoney, FULFILLABLE, numericId } from "@/lib/fulfill";
import { loadOrder } from "@/lib/orders-server";
import { requireSession } from "@/lib/session-server";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff } = await requireSession();
  const order = await loadOrder(id);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));

  return (
    <>
      <p>
        <Link href="/orders">← Orders</Link>
      </p>
      <h1>
        {order.name} {order.test ? <span className="muted">(test)</span> : null}
      </h1>
      <div className="card">
        <p>
          Payment <strong>{order.financialStatus ?? "—"}</strong> · Fulfillment <strong>{order.fulfillmentStatus ?? "—"}</strong> · Total{" "}
          <strong>{formatMoney(order.total, order.currency)}</strong>
        </p>
        <p className="muted">
          Created {formatDate(order.createdAt)}
          {order.cancelledAt ? ` · Cancelled ${formatDate(order.cancelledAt)} (${order.cancelReason ?? "no reason"})` : ""}
        </p>
        <p className="muted">
          Customer name, email and address are not stored here. Look up order <strong>{order.name}</strong> in Shopify admin if you need them.
        </p>
      </div>

      <h2>Items</h2>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>SKU</th>
            <th>Qty</th>
            <th>Unfulfilled</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.title}</td>
              <td>{l.sku ?? "—"}</td>
              <td>{l.quantity}</td>
              <td>{l.fulfillableQuantity}</td>
              <td>{formatMoney(l.discountedTotal, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Fulfillment orders</h2>
      {order.fulfillmentOrders.length === 0 ? <p className="muted">None synced yet.</p> : null}
      {order.fulfillmentOrders.map((fo) => {
        const remaining = fo.lines.reduce((n, l) => n + l.remainingQuantity, 0);
        const open = FULFILLABLE.has(fo.status) && remaining > 0;
        return (
          <div className="card" key={fo.id}>
            <p>
              <strong>{fo.status}</strong> <span className="muted">· {remaining} item(s) remaining · request {fo.requestStatus ?? "—"}</span>
            </p>
            <ul>
              {fo.lines.map((l) => (
                <li key={l.id}>
                  {(l.orderLineId && lineById.get(l.orderLineId)?.title) || "Item"} — {l.remainingQuantity} of {l.totalQuantity} remaining
                </li>
              ))}
            </ul>
            {open && canFulfill(staff.role) ? (
              <Link className="button primary" href={`/orders/${id}/fulfill?fo=${numericId(fo.id)}`}>
                Fulfill…
              </Link>
            ) : null}
          </div>
        );
      })}

      <h2>Fulfillments</h2>
      {order.fulfillments.length === 0 ? <p className="muted">None yet.</p> : null}
      <ul>
        {order.fulfillments.map((f) => (
          <li key={f.id}>
            <strong>{f.status}</strong> · {formatDate(f.createdAt)}
            {f.trackingNumber ? (
              <>
                {" "}
                · {f.trackingCompany ?? "Tracking"}{" "}
                {f.trackingUrl ? (
                  <a href={f.trackingUrl} rel="noreferrer noopener" target="_blank">
                    {f.trackingNumber}
                  </a>
                ) : (
                  f.trackingNumber
                )}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
