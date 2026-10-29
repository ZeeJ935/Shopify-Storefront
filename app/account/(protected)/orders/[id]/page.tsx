import Image from "next/image";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import PriceSummary from "@/app/account/components/price-summary";
import StatusBadge from "@/app/account/components/status-badge";
import { getCustomerOrderById } from "@/lib/customer-account/api";
import { formatMoney } from "@/lib/money";


type OrderDetailPageProps = {
  params: Promise<{ id: string }>;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function timelineSteps(order: {
  processedAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
}) {
  const paid = ["PAID", "PARTIALLY_PAID"].includes(
    (order.financialStatus || "").toUpperCase(),
  );
  const fulfilled = ["FULFILLED"].includes(
    (order.fulfillmentStatus || "").toUpperCase(),
  );

  // No "Delivered" step: the query has no delivery signal, and marking it
  // done on fulfilment would tell shoppers a parcel arrived when it only shipped.
  return [
    { label: "Placed", done: Boolean(order.processedAt) },
    { label: "Paid", done: paid },
    { label: "Shipped", done: fulfilled },
  ];
}

export default async function AccountOrderDetailPage({
  params,
}: OrderDetailPageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  let order;
  try {
    order = await getCustomerOrderById(id);
  } catch (error) {
    unstable_rethrow(error);
    return (
      <div className="rounded-xl border border-mist bg-snow p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">Order</h2>
        <p className="mt-2 text-sm text-steel">
          We couldn’t load this order. Please try again later.
        </p>
        <Link href="/account/orders" className="btn btn-secondary mt-6">
          Back to orders
        </Link>
      </div>
    );
  }

  if (!order) {
    notFound();
  }

  const steps = timelineSteps(order);
  // Hidden until a real address is configured, rather than a placeholder.
  const supportEmail = process.env.SUPPORT_EMAIL?.trim();

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-steel">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/account" className="hover:text-ink hover:underline">
              Account
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/account/orders"
              className="hover:text-ink hover:underline"
            >
              Orders
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-medium text-ink">{order.name}</li>
        </ol>
      </nav>

      <header className="space-y-4 border-b border-mist pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {order.name}
          </h2>
          <StatusBadge status={order.financialStatus} />
          <StatusBadge status={order.fulfillmentStatus} />
        </div>
        <p className="text-sm text-steel">{formatDate(order.processedAt)}</p>

        <ol className="flex flex-wrap gap-2 pt-2">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-center gap-2 text-xs">
              <span
                className={`inline-flex h-6 items-center rounded-full px-2.5 font-semibold ${
                  step.done
                    ? "bg-success/10 text-success"
                    : "bg-mist text-steel"
                }`}
              >
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span className="text-mist" aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            Items
          </h3>
          <ul className="mt-4 divide-y divide-mist rounded-xl border border-mist bg-snow shadow-sm">
            {order.lines.map((line, index) => (
              <li
                key={`${line.title}-${index}`}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto]"
              >
                <div className="relative aspect-square overflow-hidden rounded-md bg-mist">
                  {line.imageUrl ? (
                    <Image
                      src={line.imageUrl}
                      alt={line.imageAlt ?? line.title}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-ink">
                    {line.title}
                  </p>
                  {line.variantTitle ? (
                    <p className="mt-1 text-sm text-steel">{line.variantTitle}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-steel">Qty {line.quantity}</p>
                </div>
                <p className="col-span-2 text-right font-medium text-ink sm:col-span-1">
                  {line.price
                    ? formatMoney(line.price.amount, line.price.currencyCode)
                    : "—"}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/collections/all" className="btn btn-primary">
              Buy again
            </Link>
            {supportEmail ? (
              <a href={`mailto:${supportEmail}`} className="btn btn-secondary">
                Need help?
              </a>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-mist bg-snow p-5 shadow-sm">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Summary
            </h3>
            <PriceSummary
              className="mt-4"
              subtotal={order.subtotal}
              shipping={order.totalShipping}
              tax={order.totalTax}
              total={order.totalPrice}
            />
          </div>

          <div className="rounded-xl border border-mist bg-snow p-5 shadow-sm">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Payment
            </h3>
            <div className="mt-3">
              <StatusBadge status={order.financialStatus} />
            </div>
          </div>

          <div className="rounded-xl border border-mist bg-snow p-5 shadow-sm">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Shipping address
            </h3>
            {order.shippingAddress ? (
              <div className="mt-3 space-y-1 text-sm text-steel">
                {(order.shippingAddress.firstName ||
                  order.shippingAddress.lastName) && (
                  <p className="font-medium text-ink">
                    {[
                      order.shippingAddress.firstName,
                      order.shippingAddress.lastName,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                )}
                {order.shippingAddress.formatted.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-steel">No shipping address.</p>
            )}
          </div>

          {order.fulfillments.some((f) => f.trackingNumber || f.trackingUrl) ? (
            <div className="rounded-xl border border-mist bg-snow p-5 shadow-sm">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
                Tracking
              </h3>
              <ul className="mt-3 space-y-3 text-sm text-steel">
                {order.fulfillments.map((fulfillment, index) => (
                  <li key={index}>
                    {fulfillment.trackingCompany ? (
                      <p>{fulfillment.trackingCompany}</p>
                    ) : null}
                    {fulfillment.trackingNumber ? (
                      <p>{fulfillment.trackingNumber}</p>
                    ) : null}
                    {fulfillment.trackingUrl ? (
                      <a
                        href={fulfillment.trackingUrl}
                        className="font-medium text-ink underline hover:no-underline"
                        rel="noreferrer"
                        target="_blank"
                      >
                        Track shipment
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
