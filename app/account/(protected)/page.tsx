import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import OrderCard from "@/app/account/components/order-card";
import {
  getCustomerAddresses,
  getCustomerOrders,
  getCustomerProfile,
} from "@/lib/customer-account/api";

export const instant = false;

export default async function AccountPage() {
  let profile;
  let orders: Awaited<ReturnType<typeof getCustomerOrders>>["orders"] = [];
  let defaultAddress: Awaited<
    ReturnType<typeof getCustomerAddresses>
  >[number] | null = null;
  let loadError: string | null = null;

  try {
    const [p, orderResult, addresses] = await Promise.all([
      getCustomerProfile(),
      getCustomerOrders({ first: 3 }),
      getCustomerAddresses().catch(() => []),
    ]);
    profile = p;
    orders = orderResult.orders;
    defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  } catch (error) {
    unstable_rethrow(error);
    loadError =
      error instanceof Error ? error.message : "Could not load account.";
  }

  if (loadError || !profile) {
    return (
      <div className="rounded-xl border border-mist bg-snow p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-steel">
          {loadError ?? "We couldn’t load your account right now."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
            Recent orders
          </h2>
          <Link
            href="/account/orders"
            className="text-sm font-medium text-steel underline-offset-4 hover:text-ink hover:underline"
          >
            View all
          </Link>
        </div>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-mist bg-snow p-8 text-center shadow-sm">
            <p className="font-display text-base font-semibold text-ink">
              No orders yet
            </p>
            <p className="mt-2 text-sm text-steel">
              When you place an order, it will show up here.
            </p>
            <Link href="/collections/all" className="btn btn-primary mt-6">
              Start shopping
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-mist bg-snow p-5 shadow-sm">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            Default address
          </h2>
          {defaultAddress ? (
            <div className="mt-3 space-y-1 text-sm text-steel">
              {defaultAddress.formatted.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-steel">No address saved yet.</p>
          )}
          <Link
            href="/account/addresses"
            className="mt-4 inline-flex text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            Manage addresses
          </Link>
        </div>

        <div className="rounded-xl border border-mist bg-snow p-5 shadow-sm">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            Quick links
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href="/account/orders"
                className="font-medium text-steel hover:text-ink hover:underline"
              >
                Order history
              </Link>
            </li>
            <li>
              <Link
                href="/account/profile"
                className="font-medium text-steel hover:text-ink hover:underline"
              >
                Edit profile
              </Link>
            </li>
            <li>
              <Link
                href="/collections/all"
                className="font-medium text-steel hover:text-ink hover:underline"
              >
                Continue shopping
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
