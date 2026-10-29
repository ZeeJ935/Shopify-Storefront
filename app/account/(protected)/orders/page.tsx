import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import OrderCard from "@/app/account/components/order-card";
import { getCustomerOrders } from "@/lib/customer-account/api";


type OrdersPageProps = {
  searchParams: Promise<{ after?: string; before?: string }>;
};

export default async function AccountOrdersPage({
  searchParams,
}: OrdersPageProps) {
  const { after, before } = await searchParams;

  let orders;
  let pageInfo;
  try {
    const result = await getCustomerOrders({
      pageSize: 10,
      after: before ? null : (after ?? null),
      before: before ?? null,
    });
    orders = result.orders;
    pageInfo = result.pageInfo;
  } catch (error) {
    unstable_rethrow(error);
    return (
      <div className="rounded-xl border border-mist bg-snow p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">Orders</h2>
        <p className="mt-2 text-sm text-steel">
          We couldn’t load your orders. Please try again later.
        </p>
      </div>
    );
  }

  // Relay only guarantees hasPreviousPage when paging backward, so a page
  // reached with `after` always has newer orders; with `before`, ask Shopify.
  const showPrevious = before ? pageInfo.hasPreviousPage : Boolean(after);
  // Paging backward means we came from an older page, so one always exists.
  const showNext = before ? true : pageInfo.hasNextPage;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Orders
        </h2>
        <p className="mt-1 text-sm text-steel">
          Track purchases and view order details.
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-mist bg-snow px-6 py-14 text-center shadow-sm">
          <h3 className="font-display text-xl font-semibold text-ink">
            No orders yet
          </h3>
          <p className="mt-2 text-sm text-steel">
            When you place an order, it will appear here.
          </p>
          <Link href="/collections/all" className="btn btn-primary mt-8">
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} />
            </li>
          ))}
        </ul>
      )}

      {showPrevious || showNext ? (
        <nav aria-label="Orders pages" className="flex justify-between gap-3">
          {showPrevious && pageInfo.startCursor ? (
            <Link
              href={`/account/orders?before=${encodeURIComponent(pageInfo.startCursor)}`}
              className="btn btn-secondary"
            >
              ← Newer orders
            </Link>
          ) : (
            <span />
          )}
          {showNext && pageInfo.endCursor ? (
            <Link
              href={`/account/orders?after=${encodeURIComponent(pageInfo.endCursor)}`}
              className="btn btn-secondary"
            >
              Older orders →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
