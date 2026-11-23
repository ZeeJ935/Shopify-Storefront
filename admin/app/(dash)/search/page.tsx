import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";
import { fulfillmentBadge, paymentBadge, stockBadge } from "@/lib/badges";
import { formatDate, numericId } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { SearchResults } from "@/lib/types-summary";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim().slice(0, 100) ?? "";
  if (!q) redirect("/orders");
  const r = await staffFetch<SearchResults>(`/admin/search?${new URLSearchParams({ q })}`);
  // An exact order number goes straight to the order.
  if (r.exactOrderId && r.skus.length === 0) redirect(`/orders/${numericId(r.exactOrderId)}`);

  return (
    <Page title={`Results for “${q}”`} narrow>
      {r.orders.length === 0 && r.skus.length === 0 ? (
        <Card>
          <div className="py-8">
            <EmptyState title="No results">Search by order number (e.g. #1007) or SKU. Customer names and emails aren&apos;t searchable here.</EmptyState>
          </div>
        </Card>
      ) : null}
      {r.orders.length ? (
        <Card title="Orders" padded={false}>
          <ul>
            {r.orders.map((o) => {
              const pay = paymentBadge(o.financialStatus);
              const ful = fulfillmentBadge(o.fulfillmentStatus);
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 first:border-t-0 hover:bg-surface-hover">
                  <Link href={`/orders/${numericId(o.id)}`} className="font-semibold text-fg no-underline hover:underline">
                    {o.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="text-subdued">{formatDate(o.createdAt)}</span>
                    <Badge tone={pay.tone} dot={pay.dot}>
                      {pay.label}
                    </Badge>
                    <Badge tone={ful.tone} dot={ful.dot}>
                      {ful.label}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {r.skus.length ? (
        <Card title="SKUs" padded={false}>
          <ul>
            {r.skus.map((s) => {
              const b = stockBadge(s.available);
              return (
                <li key={s.inventoryItemId} className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 first:border-t-0 hover:bg-surface-hover">
                  <Link href={`/inventory?${new URLSearchParams({ sku: s.sku })}`} className="font-semibold text-fg no-underline hover:underline">
                    {s.sku}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="text-subdued tabular-nums">
                      {s.available} available · {s.locations} location{s.locations === 1 ? "" : "s"}
                    </span>
                    <Badge tone={b.tone}>{b.label}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </Page>
  );
}
