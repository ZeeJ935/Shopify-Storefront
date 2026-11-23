import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { Stat } from "@/components/ui/Stat";
import { roleLabel } from "@/lib/badges";
import { requireSession, staffFetch } from "@/lib/session-server";
import type { AdminSummary } from "@/lib/types-summary";

export default async function Home({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const { forbidden } = await searchParams;
  const { staff, sessionExpiresAt } = await requireSession();
  const s = await staffFetch<AdminSummary>("/admin/summary");
  const firstName = staff.email.split("@")[0].split(/[._-]/)[0];

  return (
    <Page title={`Good to see you, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`} subtitle={`${roleLabel(staff.role)} · session ends ${new Date(sessionExpiresAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}>
      {forbidden ? <Banner tone="warning" title="Your role can't open that page" /> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Orders to fulfill" value={s.unfulfilledOrders} href="/orders?fulfillment_status=UNFULFILLED" tone={s.unfulfilledOrders ? "attention" : undefined} />
        <Stat label="Orders, last 7 days" value={s.ordersLast7Days} href="/orders" />
        <Stat label={`Low stock (≤ ${s.lowStockAt})`} value={s.lowStockLevels} href={`/inventory?low_stock_below=${s.lowStockAt + 1}`} tone={s.lowStockLevels ? "attention" : undefined} />
        <Stat label="Out of stock" value={s.outOfStockLevels} href="/inventory?low_stock_below=1" tone={s.outOfStockLevels ? "critical" : undefined} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Fulfillment">
          <ul className="flex flex-col gap-1.5">
            <li className="flex justify-between">
              <span className="text-subdued">Open fulfillment orders</span>
              <span className="font-semibold tabular-nums">{s.openFulfillmentOrders}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-subdued">Fulfillments in progress</span>
              <span className="font-semibold tabular-nums">{s.pendingFulfillments}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-subdued">Failed in the last 7 days</span>
              <span className={s.failedFulfillments7Days ? "font-semibold text-critical tabular-nums" : "font-semibold tabular-nums"}>{s.failedFulfillments7Days}</span>
            </li>
          </ul>
        </Card>
        <Card title="Customer details">
          <p className="text-subdued">
            Names, emails and addresses aren&apos;t stored or shown here. When you need them, look the order up in <strong className="text-fg">Shopify admin</strong> by its order number.
          </p>
        </Card>
      </div>
    </Page>
  );
}
