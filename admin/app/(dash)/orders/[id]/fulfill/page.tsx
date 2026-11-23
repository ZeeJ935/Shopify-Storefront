import { notFound } from "next/navigation";
import { FulfillFlow } from "@/components/FulfillFlow";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";
import { FULFILLABLE } from "@/lib/fulfill";
import { loadOrder } from "@/lib/orders-server";
import { requireSession } from "@/lib/session-server";

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
    <Page title={`Fulfill items`} subtitle={order.name} backHref={`/orders/${id}`} narrow>
      {!FULFILLABLE.has(fo.status) || lines.length === 0 ? (
        <Card>
          <div className="py-8">
            <EmptyState title="Nothing left to fulfill">Every item on this fulfillment order has been fulfilled.</EmptyState>
          </div>
        </Card>
      ) : (
        <FulfillFlow orderId={id} orderName={order.name} foId={foId} lines={lines} />
      )}
    </Page>
  );
}
