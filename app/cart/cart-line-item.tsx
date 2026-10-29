"use client";

import Image from "next/image";
import Link from "next/link";
import Spinner from "@/app/components/spinner";
import type { CartLine } from "@/lib/cart";
import { formatMoneyValue } from "@/lib/money";
import CartLineControls from "./cart-line-controls";

type CartLineItemProps = {
  line: CartLine;
  pending: boolean;
  /** Narrow layout for the cart drawer. */
  compact?: boolean;
  onNavigate?: () => void;
};

function allocationLabel(allocation: CartLine["discountAllocations"][number]) {
  return (
    allocation.sourceDiscountApplication.code ??
    allocation.sourceDiscountApplication.title ??
    null
  );
}

function LineTotal({ line, pending }: { line: CartLine; pending: boolean }) {
  const discounted = line.discountAllocations.length > 0;

  // The discounted total is only known once Shopify confirms the new quantity.
  if (pending && discounted) {
    return (
      <p className="inline-flex items-center gap-2 font-display text-base font-semibold text-steel">
        <Spinner size="sm" />
        {formatMoneyValue(line.cost.subtotalAmount)}
      </p>
    );
  }

  if (line.cost.subtotalAmount.amount !== line.cost.totalAmount.amount) {
    return (
      <p className="font-display text-base font-semibold text-ink">
        <span className="mr-2 text-sm font-normal text-steel line-through">
          {formatMoneyValue(line.cost.subtotalAmount)}
        </span>
        {formatMoneyValue(line.cost.totalAmount)}
      </p>
    );
  }

  return (
    <p className="font-display text-base font-semibold text-ink">
      {formatMoneyValue(line.cost.totalAmount)}
    </p>
  );
}

export default function CartLineItem({
  line,
  pending,
  compact = false,
  onNavigate,
}: CartLineItemProps) {
  const showVariant =
    line.merchandise.title.trim().toLowerCase() !== "default title";
  const compareAt = line.cost.compareAtAmountPerQuantity;
  const showCompareAt =
    compareAt !== null &&
    Number(compareAt.amount) > Number(line.cost.amountPerQuantity.amount);
  const allocationNote = line.discountAllocations
    .map(allocationLabel)
    .find(Boolean);
  const productHref = `/products/${line.merchandise.product.handle}`;

  return (
    <li
      className={
        compact
          ? "grid grid-cols-[5rem_minmax(0,1fr)] gap-4 py-5"
          : "grid grid-cols-[7rem_minmax(0,1fr)] gap-4 py-8 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-8"
      }
    >
      <Link
        href={productHref}
        onClick={onNavigate}
        className="relative aspect-[4/5] overflow-hidden bg-mist"
      >
        {line.merchandise.image ? (
          <Image
            src={line.merchandise.image.url}
            alt={line.merchandise.image.altText ?? line.merchandise.product.title}
            fill
            sizes={compact ? "80px" : "128px"}
            className="object-cover"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center px-2 text-center text-xs text-steel"
            aria-hidden="true"
          >
            No image
          </div>
        )}
      </Link>

      <div className={compact ? "min-w-0 space-y-3" : "min-w-0 space-y-4"}>
        <div>
          <Link
            href={productHref}
            onClick={onNavigate}
            className={`font-display font-semibold uppercase tracking-wide text-ink hover:underline ${
              compact ? "text-sm" : "text-base sm:text-lg"
            }`}
          >
            {line.merchandise.product.title}
          </Link>
          {showVariant ? (
            <p className="mt-1.5 text-sm text-steel">{line.merchandise.title}</p>
          ) : null}
          <p className={compact ? "mt-2 text-sm text-ink" : "mt-3 text-sm text-ink"}>
            {showCompareAt && compareAt ? (
              <>
                <span className="mr-2 text-steel line-through">
                  {formatMoneyValue(compareAt)}
                </span>
                <span className="font-medium text-sale">
                  {formatMoneyValue(line.cost.amountPerQuantity)}
                </span>
              </>
            ) : (
              <span className="font-medium">
                {formatMoneyValue(line.cost.amountPerQuantity)}
              </span>
            )}
          </p>
          {allocationNote ? (
            <p className="mt-1 text-xs text-steel">Includes {allocationNote}</p>
          ) : null}
        </div>

        <CartLineControls
          lineId={line.id}
          productTitle={line.merchandise.product.title}
          quantity={line.quantity}
        />

        {compact ? <LineTotal line={line} pending={pending} /> : null}
      </div>

      {compact ? null : (
        <div className="col-span-2 text-right sm:col-span-1 sm:pt-1">
          <LineTotal line={line} pending={pending} />
        </div>
      )}
    </li>
  );
}
