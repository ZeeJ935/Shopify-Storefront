import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerOrderById } from "@/lib/customer-account/api";
import { formatMoney } from "@/lib/money";

export const instant = false;

type OrderDetailPageProps = {
  params: Promise<{ id: string }>;
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

export default async function AccountOrderDetailPage({
  params,
}: OrderDetailPageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const order = await getCustomerOrderById(id);

  if (!order) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <Link
        href="/account/orders"
        className="text-sm font-medium text-steel hover:text-ink hover:underline"
      >
        ← Orders
      </Link>

      <div className="mt-6 border-b border-mist pb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {order.name}
        </h1>
        <p className="mt-3 text-sm text-steel">
          {formatDate(order.processedAt)}
          {order.financialStatus
            ? ` · ${order.financialStatus.replaceAll("_", " ")}`
            : ""}
          {order.fulfillmentStatus
            ? ` · ${order.fulfillmentStatus.replaceAll("_", " ")}`
            : ""}
        </p>
      </div>

      <ul className="mt-8 divide-y divide-mist border-y border-mist">
        {order.lines.map((line, index) => (
          <li
            key={`${line.title}-${index}`}
            className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 py-6 sm:grid-cols-[6rem_minmax(0,1fr)_auto]"
          >
            <div className="relative aspect-square overflow-hidden bg-mist">
              {line.imageUrl ? (
                <Image
                  src={line.imageUrl}
                  alt={line.imageAlt ?? line.title}
                  fill
                  sizes="96px"
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

      <div className="mt-8 max-w-sm space-y-3 text-sm sm:ml-auto">
        {order.subtotal ? (
          <div className="flex justify-between gap-4">
            <span className="text-steel">Subtotal</span>
            <span className="text-ink">
              {formatMoney(order.subtotal.amount, order.subtotal.currencyCode)}
            </span>
          </div>
        ) : null}
        {order.totalShipping ? (
          <div className="flex justify-between gap-4">
            <span className="text-steel">Shipping</span>
            <span className="text-ink">
              {formatMoney(
                order.totalShipping.amount,
                order.totalShipping.currencyCode,
              )}
            </span>
          </div>
        ) : null}
        {order.totalTax ? (
          <div className="flex justify-between gap-4">
            <span className="text-steel">Tax</span>
            <span className="text-ink">
              {formatMoney(order.totalTax.amount, order.totalTax.currencyCode)}
            </span>
          </div>
        ) : null}
        {order.totalPrice ? (
          <div className="flex justify-between gap-4 border-t border-mist pt-3">
            <span className="font-semibold text-ink">Total</span>
            <span className="font-semibold text-ink">
              {formatMoney(
                order.totalPrice.amount,
                order.totalPrice.currencyCode,
              )}
            </span>
          </div>
        ) : null}
      </div>

      {order.fulfillments.some((f) => f.trackingNumber || f.trackingUrl) ? (
        <section className="mt-12 border-t border-mist pt-8">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink">
            Tracking
          </h2>
          <ul className="mt-4 space-y-3 text-sm text-steel">
            {order.fulfillments.map((fulfillment, index) => (
              <li key={index}>
                {fulfillment.status ? (
                  <p className="text-ink">{fulfillment.status}</p>
                ) : null}
                {fulfillment.trackingCompany ? (
                  <p>{fulfillment.trackingCompany}</p>
                ) : null}
                {fulfillment.trackingNumber ? (
                  <p>{fulfillment.trackingNumber}</p>
                ) : null}
                {fulfillment.trackingUrl ? (
                  <a
                    href={fulfillment.trackingUrl}
                    className="underline hover:text-ink"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Track shipment
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
