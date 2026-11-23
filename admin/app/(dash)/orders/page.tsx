import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { IndexTable } from "@/components/ui/IndexTable";
import { Page } from "@/components/ui/Page";
import { Pagination } from "@/components/ui/Pagination";
import { Tabs } from "@/components/ui/Tabs";
import { fulfillmentBadge, paymentBadge } from "@/lib/badges";
import { formatDate, formatMoney, numericId } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { OrderSummary } from "@/lib/types";

type Search = { status?: string; financial_status?: string; fulfillment_status?: string; cursor?: string };

/** Saved views, like Shopify's order tabs. */
const VIEWS = [
  { key: "all", label: "All", params: {} },
  { key: "unfulfilled", label: "Unfulfilled", params: { fulfillment_status: "UNFULFILLED", status: "open" } },
  { key: "unpaid", label: "Unpaid", params: { financial_status: "PENDING" } },
  { key: "open", label: "Open", params: { status: "open" } },
  { key: "closed", label: "Closed", params: { status: "closed" } },
  { key: "cancelled", label: "Cancelled", params: { status: "cancelled" } },
] as const;
const allowed = { status: ["open", "closed", "cancelled"], financial_status: ["PAID", "PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "AUTHORIZED", "VOIDED"], fulfillment_status: ["UNFULFILLED", "FULFILLED", "PARTIALLY_FULFILLED", "ON_HOLD", "IN_PROGRESS"] };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filters: Record<string, string> = {};
  for (const [k, values] of Object.entries(allowed)) {
    const v = sp[k as keyof Search];
    if (v && (values as string[]).includes(v)) filters[k] = v;
  }
  const q = new URLSearchParams({ limit: "25", ...filters });
  if (sp.cursor && /^[A-Za-z0-9_-]{1,500}$/.test(sp.cursor)) q.set("cursor", sp.cursor);
  const { orders, nextCursor } = await staffFetch<{ orders: OrderSummary[]; nextCursor: string | null }>(`/admin/orders?${q}`);

  const base = new URLSearchParams(filters).toString();
  const selected = VIEWS.find((v) => JSON.stringify(Object.entries(v.params).sort()) === JSON.stringify(Object.entries(filters).sort()));
  const tabs = VIEWS.map((v) => ({ label: v.label, href: `/orders${Object.keys(v.params).length ? `?${new URLSearchParams(v.params)}` : ""}`, selected: v.key === (selected?.key ?? "") }));

  return (
    <Page title="Orders">
      <IndexTable
        toolbar={<Tabs tabs={tabs} />}
        columns={[
          { key: "order", label: "Order" },
          { key: "date", label: "Date" },
          { key: "total", label: "Total", align: "end" },
          { key: "payment", label: "Payment status" },
          { key: "fulfillment", label: "Fulfillment status" },
        ]}
        rows={orders.map((o) => {
          const pay = paymentBadge(o.financialStatus);
          const ful = fulfillmentBadge(o.fulfillmentStatus);
          return {
            key: o.id,
            cells: {
              order: (
                <span className="flex items-center gap-2">
                  <Link href={`/orders/${numericId(o.id)}`} className="font-semibold text-fg no-underline hover:underline">
                    {o.name}
                  </Link>
                  {o.test ? <Badge tone="info">Test</Badge> : null}
                  {o.cancelledAt ? <Badge tone="critical">Cancelled</Badge> : null}
                </span>
              ),
              date: <span className="whitespace-nowrap text-subdued">{formatDate(o.createdAt)}</span>,
              total: formatMoney(o.total, o.currency),
              payment: (
                <Badge tone={pay.tone} dot={pay.dot}>
                  {pay.label}
                </Badge>
              ),
              fulfillment: (
                <Badge tone={ful.tone} dot={ful.dot}>
                  {ful.label}
                </Badge>
              ),
            },
          };
        })}
        empty={<EmptyState title="No orders found">Try another view, or wait for the next orders sync.</EmptyState>}
        footer={
          sp.cursor || nextCursor ? (
            <Pagination firstHref={sp.cursor ? `/orders${base ? `?${base}` : ""}` : null} nextHref={nextCursor ? `/orders?${new URLSearchParams({ ...filters, cursor: nextCursor })}` : null} />
          ) : null
        }
      />
    </Page>
  );
}
