import Link from "next/link";
import { getCustomerOrders } from "@/lib/customer-account/api";
import { formatMoney } from "@/lib/money";

export const instant = false;

type OrdersPageProps = {
  searchParams: Promise<{ after?: string }>;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export default async function AccountOrdersPage({
  searchParams,
}: OrdersPageProps) {
  const { after } = await searchParams;

  let orders;
  let pageInfo;
  try {
    const result = await getCustomerOrders({ first: 10, after: after ?? null });
    orders = result.orders;
    pageInfo = result.pageInfo;
  } catch {
    return (
      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Link
          href="/account"
          className="text-sm font-medium text-steel hover:text-ink hover:underline"
        >
          ← Account
        </Link>
        <h1 className="mt-6 font-display text-3xl font-semibold text-ink">
          Orders
        </h1>
        <p className="mt-4 text-steel">
          We couldn&apos;t load your orders. Please try again later.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <Link
        href="/account"
        className="text-sm font-medium text-steel hover:text-ink hover:underline"
      >
        ← Account
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Orders
      </h1>

      {orders.length === 0 ? (
        <div className="mt-12 max-w-lg border-y border-mist py-12">
          <h2 className="font-display text-xl font-semibold text-ink">
            No orders yet
          </h2>
          <p className="mt-3 text-steel">
            When you place an order, it will appear here.
          </p>
          <Link href="/collections/all" className="btn btn-primary mt-8">
            Continue shopping
          </Link>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-mist border-y border-mist">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/account/orders/${encodeURIComponent(order.id)}`}
                className="grid gap-2 py-6 transition-colors hover:bg-mist/30 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-display text-base font-semibold text-ink">
                    {order.name}
                  </p>
                  <p className="mt-1 text-sm text-steel">
                    {formatDate(order.processedAt)}
                    {order.financialStatus
                      ? ` · ${order.financialStatus.replaceAll("_", " ")}`
                      : ""}
                    {order.fulfillmentStatus
                      ? ` · ${order.fulfillmentStatus.replaceAll("_", " ")}`
                      : ""}
                  </p>
                </div>
                <p className="font-medium text-ink sm:text-right">
                  {order.totalPrice
                    ? formatMoney(
                        order.totalPrice.amount,
                        order.totalPrice.currencyCode,
                      )
                    : "—"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pageInfo.hasNextPage && pageInfo.endCursor ? (
        <Link
          href={`/account/orders?after=${encodeURIComponent(pageInfo.endCursor)}`}
          className="btn btn-secondary mt-8"
        >
          Load more
        </Link>
      ) : null}
    </main>
  );
}
