import Link from "next/link";
import { formatDate, formatMoney, numericId } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { OrderSummary } from "@/lib/types";

type Search = { status?: string; financial_status?: string; fulfillment_status?: string; cursor?: string };
const pick = (v: string | undefined, allowed: string[]) => (v && allowed.includes(v) ? v : undefined);

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ limit: "25" });
  const status = pick(sp.status, ["open", "closed", "cancelled"]);
  const financial = pick(sp.financial_status, ["PAID", "PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "AUTHORIZED", "VOIDED"]);
  const fulfillment = pick(sp.fulfillment_status, ["UNFULFILLED", "FULFILLED", "PARTIALLY_FULFILLED", "ON_HOLD", "IN_PROGRESS"]);
  if (status) q.set("status", status);
  if (financial) q.set("financial_status", financial);
  if (fulfillment) q.set("fulfillment_status", fulfillment);
  if (sp.cursor && /^[A-Za-z0-9_-]{1,500}$/.test(sp.cursor)) q.set("cursor", sp.cursor);
  const { orders, nextCursor } = await staffFetch<{ orders: OrderSummary[]; nextCursor: string | null }>(`/admin/orders?${q}`);

  const next = new URLSearchParams({ ...(status ? { status } : {}), ...(financial ? { financial_status: financial } : {}), ...(fulfillment ? { fulfillment_status: fulfillment } : {}) });
  if (nextCursor) next.set("cursor", nextCursor);

  return (
    <>
      <h1>Orders</h1>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select name="status" defaultValue={status ?? ""}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select name="fulfillment_status" defaultValue={fulfillment ?? ""}>
          <option value="">Any fulfillment</option>
          <option value="UNFULFILLED">Unfulfilled</option>
          <option value="PARTIALLY_FULFILLED">Partially fulfilled</option>
          <option value="FULFILLED">Fulfilled</option>
        </select>
        <select name="financial_status" defaultValue={financial ?? ""}>
          <option value="">Any payment</option>
          <option value="PAID">Paid</option>
          <option value="PENDING">Pending</option>
          <option value="REFUNDED">Refunded</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Created</th>
            <th>Payment</th>
            <th>Fulfillment</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/orders/${numericId(o.id)}`}>{o.name}</Link> {o.test ? <span className="muted">(test)</span> : null}
                {o.cancelledAt ? <span className="error"> cancelled</span> : null}
              </td>
              <td>{formatDate(o.createdAt)}</td>
              <td>{o.financialStatus ?? "—"}</td>
              <td>{o.fulfillmentStatus ?? "—"}</td>
              <td>{formatMoney(o.total, o.currency)}</td>
            </tr>
          ))}
          {orders.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No orders match.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {nextCursor ? (
        <p>
          <Link href={`/orders?${next}`}>Next page →</Link>
        </p>
      ) : null}
    </>
  );
}
