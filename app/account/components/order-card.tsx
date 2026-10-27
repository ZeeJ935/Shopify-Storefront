import Image from "next/image";
import Link from "next/link";
import type { CustomerOrderSummary } from "@/lib/customer-account/api";
import { formatMoney } from "@/lib/money";
import StatusBadge from "./status-badge";

export type OrderCardThumb = {
  imageUrl: string | null;
  imageAlt: string | null;
  title: string;
};

type OrderCardProps = {
  order: CustomerOrderSummary & { thumbs?: OrderCardThumb[] };
  compact?: boolean;
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

export default function OrderCard({ order, compact = false }: OrderCardProps) {
  const thumbs = order.thumbs ?? [];
  const shown = thumbs.slice(0, 3);
  const extra = Math.max(0, thumbs.length - shown.length);
  const href = `/account/orders/${encodeURIComponent(order.id)}`;

  return (
    <article className="group relative rounded-xl border border-mist bg-snow p-4 shadow-sm transition hover:border-steel/40 hover:shadow-md sm:p-5">
      <Link
        href={href}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label={`View order ${order.name}`}
      />
      <div className="relative z-10 pointer-events-none flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-semibold text-ink">
              {order.name}
            </h3>
            <StatusBadge status={order.financialStatus} />
            <StatusBadge status={order.fulfillmentStatus} />
          </div>
          <p className="text-sm text-steel">{formatDate(order.processedAt)}</p>
          {!compact && shown.length > 0 ? (
            <div className="flex items-center gap-2 pt-1">
              {shown.map((thumb, i) => (
                <div
                  key={`${order.id}-thumb-${i}`}
                  className="relative h-12 w-12 overflow-hidden rounded-md bg-mist"
                >
                  {thumb.imageUrl ? (
                    <Image
                      src={thumb.imageUrl}
                      alt={thumb.imageAlt ?? thumb.title}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
              ))}
              {extra > 0 ? (
                <span className="text-xs font-semibold text-steel">+{extra}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <p className="font-semibold text-ink">
            {order.totalPrice
              ? formatMoney(
                  order.totalPrice.amount,
                  order.totalPrice.currencyCode,
                )
              : "—"}
          </p>
          <span className="btn btn-secondary !min-h-10 !px-3 !py-2 text-sm group-hover:border-steel">
            View order
          </span>
        </div>
      </div>
    </article>
  );
}
