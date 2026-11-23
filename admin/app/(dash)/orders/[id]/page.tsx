import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardSection } from "@/components/ui/Card";
import { ExternalIcon, TruckIcon } from "@/components/ui/Icons";
import { Layout, Page } from "@/components/ui/Page";
import { fulfillmentBadge, fulfillmentOrderBadge, paymentBadge } from "@/lib/badges";
import { canFulfill, formatDate, formatMoney, FULFILLABLE, numericId } from "@/lib/fulfill";
import { loadOrder } from "@/lib/orders-server";
import { requireSession } from "@/lib/session-server";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff } = await requireSession();
  const order = await loadOrder(id);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));
  const pay = paymentBadge(order.financialStatus);
  const ful = fulfillmentBadge(order.fulfillmentStatus);
  const money = (v: string | null) => formatMoney(v, order.currency);

  return (
    <Page
      title={order.name}
      backHref="/orders"
      titleMeta={
        <>
          <Badge tone={pay.tone} dot={pay.dot}>
            {pay.label}
          </Badge>
          <Badge tone={ful.tone} dot={ful.dot}>
            {ful.label}
          </Badge>
          {order.test ? <Badge tone="info">Test</Badge> : null}
          {order.cancelledAt ? <Badge tone="critical">Cancelled</Badge> : null}
        </>
      }
      subtitle={`${formatDate(order.createdAt)}${order.sourceName ? ` · ${order.sourceName.startsWith("channel:") ? "Online store" : order.sourceName}` : ""}`}
    >
      <Layout
        main={
          <>
            {order.fulfillmentOrders.map((fo) => {
              const remaining = fo.lines.reduce((n, l) => n + l.remainingQuantity, 0);
              const badge = fulfillmentOrderBadge(fo.status);
              const open = FULFILLABLE.has(fo.status) && remaining > 0;
              return (
                <Card
                  key={fo.id}
                  title={
                    <span className="flex items-center gap-2">
                      <Badge tone={badge.tone} dot={badge.dot}>
                        {badge.label}
                      </Badge>
                      <span className="font-normal text-subdued">{remaining > 0 ? `${remaining} item${remaining === 1 ? "" : "s"} left` : "All items fulfilled"}</span>
                    </span>
                  }
                  padded={false}
                >
                  <ul>
                    {fo.lines.map((l) => {
                      const line = l.orderLineId ? lineById.get(l.orderLineId) : undefined;
                      return (
                        <li key={l.id} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-t-0">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{line?.title ?? "Item"}</p>
                            <p className="text-xs text-subdued">SKU: {line?.sku ?? "—"}</p>
                          </div>
                          <p className="shrink-0 text-subdued tabular-nums">
                            {l.remainingQuantity} of {l.totalQuantity} left
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                  {open && canFulfill(staff.role) ? (
                    <div className="flex justify-end border-t border-line px-4 py-3">
                      <LinkButton variant="primary" href={`/orders/${id}/fulfill?fo=${numericId(fo.id)}`}>
                        Fulfill items
                      </LinkButton>
                    </div>
                  ) : null}
                </Card>
              );
            })}
            {order.fulfillmentOrders.length === 0 ? (
              <Card title="Items" padded={false}>
                <ul>
                  {order.lines.map((l) => (
                    <li key={l.id} className="flex justify-between border-t border-line px-4 py-3 first:border-t-0">
                      <span>{l.title}</span>
                      <span className="text-subdued tabular-nums">× {l.quantity}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {order.fulfillments.length ? (
              <Card title="Shipments" padded={false}>
                <ul>
                  {order.fulfillments.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 first:border-t-0">
                      <span className="flex items-center gap-2">
                        <TruckIcon className="size-4 text-subdued" />
                        <Badge tone={f.status === "SUCCESS" ? "success" : f.status === "CANCELLED" || f.status === "FAILURE" ? "critical" : "neutral"}>{f.status.charAt(0) + f.status.slice(1).toLowerCase()}</Badge>
                        <span className="text-subdued">{formatDate(f.createdAt)}</span>
                      </span>
                      {f.trackingNumber ? (
                        <span>
                          {f.trackingCompany ? `${f.trackingCompany} · ` : ""}
                          {f.trackingUrl ? (
                            <a href={f.trackingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">
                              {f.trackingNumber}
                              <ExternalIcon className="size-3.5" />
                            </a>
                          ) : (
                            f.trackingNumber
                          )}
                        </span>
                      ) : (
                        <span className="text-subdued">No tracking</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card title="Payment" padded={false}>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 px-4 pb-3">
                <dt className="text-subdued">Subtotal</dt>
                <dd className="text-right tabular-nums">{money(order.subtotal)}</dd>
                <dt className="text-subdued">Discount</dt>
                <dd className="text-right tabular-nums">{money(order.discount)}</dd>
                <dt className="text-subdued">Tax</dt>
                <dd className="text-right tabular-nums">{money(order.tax)}</dd>
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold tabular-nums">{money(order.total)}</dd>
              </dl>
            </Card>
          </>
        }
        aside={
          <>
            <Card title="Customer">
              <p className="text-subdued">
                Customer name, email and address aren&apos;t stored here. Look up <strong className="text-fg">{order.name}</strong> in Shopify admin.
              </p>
            </Card>
            <Card title="Order details" padded={false}>
              <CardSection>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  <dt className="text-subdued">Created</dt>
                  <dd>{formatDate(order.createdAt)}</dd>
                  <dt className="text-subdued">Updated</dt>
                  <dd>{formatDate(order.updatedAt)}</dd>
                  {order.closedAt ? (
                    <>
                      <dt className="text-subdued">Closed</dt>
                      <dd>{formatDate(order.closedAt)}</dd>
                    </>
                  ) : null}
                  {order.cancelledAt ? (
                    <>
                      <dt className="text-subdued">Cancelled</dt>
                      <dd>
                        {formatDate(order.cancelledAt)}
                        {order.cancelReason ? ` (${order.cancelReason.toLowerCase()})` : ""}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </CardSection>
            </Card>
          </>
        }
      />
    </Page>
  );
}
