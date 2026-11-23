import Link from "next/link";
import { notFound } from "next/navigation";
import { FulfillFlow } from "@/components/FulfillFlow";
import { FULFILLABLE } from "@/lib/fulfill";
import { requireSession } from "@/lib/session-server";
import { loadOrder } from "@/lib/orders-server";

export default async function FulfillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fo?: string }> }) {
  await requireSession("operator");
  const { id } = await params;
  const { fo: foId } = await searchParams;
  if (!foId || !/^\d{1,20}$/.test(foId)) notFound();
  const order = await loadOrder(id);
  const fo = order.fulfillmentOrders.find((f) => f.id === `gid://shopify/FulfillmentOrder/${foId}`);
  if (!fo) notFound();
  const lineById = new Map(order.lines.map((l) => [l.id, l]));
  const lines = fo.lines
    .filter((l) => l.remainingQuantity > 0)
    .map((l) => {
      const ol = l.orderLineId ? lineById.get(l.orderLineId) : undefined;
      return { id: l.id, title: ol?.title ?? "Item", sku: ol?.sku ?? null, remaining: l.remainingQuantity };
    });

  return (
    <>
      <p>
        <Link href={`/orders/${id}`}>← {order.name}</Link>
      </p>
      <h1>Fulfill {order.name}</h1>
      {!FULFILLABLE.has(fo.status) || lines.length === 0 ? (
        <p className="muted">Nothing left to fulfill on this fulfillment order.</p>
      ) : (
        <FulfillFlow orderId={id} foId={foId} lines={lines} />
      )}
    </>
  );
}
