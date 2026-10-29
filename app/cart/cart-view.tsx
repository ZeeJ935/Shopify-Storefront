"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCart, useSeededCart } from "@/app/components/cart-provider";
import SiteContainer from "@/app/components/site-container";
import Spinner from "@/app/components/spinner";
import type { Cart } from "@/lib/cart";
import { formatMoneyValue } from "@/lib/money";
import CartLineItem from "./cart-line-item";
import CheckoutButton from "./checkout-button";
import DiscountCodeForm from "./discount-code-form";
import EmptyBag from "./empty-bag";

type CartViewProps = {
  initialCart: Cart | null;
  /** Server-streamed "You may also like" section. */
  recommendations?: ReactNode;
};

function discountLabel(application: Cart["discountApplications"][number]) {
  return application.code ?? application.title ?? "Discount";
}

export default function CartView({
  initialCart,
  recommendations,
}: CartViewProps) {
  const cart = useSeededCart(initialCart);
  const { pending, pendingLineIds } = useCart();

  if (!cart || cart.lines.length === 0) {
    return (
      <SiteContainer boxed className="py-14 sm:py-20">
        <EmptyBag
          title="Your bag is empty"
          description="Looks like you haven't added anything yet. Explore the catalog and find your next gear."
        />
        {recommendations}
      </SiteContainer>
    );
  }

  const discountRows = cart.discountApplications.filter(
    (application) => Number(application.totalAllocatedAmount.amount) > 0,
  );

  return (
    <SiteContainer boxed className="py-10 sm:py-14 lg:py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-mist pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Your Bag
          </h1>
          <p className="mt-2 text-sm uppercase tracking-[0.12em] text-steel">
            {cart.totalQuantity} item{cart.totalQuantity === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/collections/all"
          className="inline-flex min-h-11 items-center text-sm font-medium text-steel underline-offset-4 hover:text-ink hover:underline"
        >
          Continue shopping
        </Link>
      </div>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-16">
        <ul className="divide-y divide-mist border-y border-mist">
          {cart.lines.map((line) => (
            <CartLineItem
              key={line.id}
              line={line}
              pending={pendingLineIds.has(line.id)}
            />
          ))}
        </ul>

        <aside className="border-t border-mist pt-8 lg:sticky lg:top-28 lg:border-t-0 lg:bg-mist/35 lg:px-6 lg:py-7 lg:pt-7">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink">
            Summary
          </h2>

          <div className="mt-6 space-y-3 text-sm" aria-busy={pending}>
            <div className="flex items-center justify-between gap-4">
              <span className="text-steel">Subtotal</span>
              <span className="font-medium text-ink">
                {formatMoneyValue(cart.cost.subtotalAmount)}
              </span>
            </div>

            {discountRows.map((application, index) => (
              <div
                key={`${discountLabel(application)}-${index}`}
                className="flex items-center justify-between gap-4"
              >
                <span className="text-steel">
                  Discount ({discountLabel(application)})
                </span>
                <span className="inline-flex items-center gap-2 font-medium text-ink">
                  {pending ? <Spinner size="sm" className="text-steel" /> : null}
                  −{formatMoneyValue(application.totalAllocatedAmount)}
                </span>
              </div>
            ))}

            <div className="flex items-center justify-between gap-4 border-t border-mist pt-4">
              <span className="font-display text-base font-semibold text-ink">
                Estimated total
              </span>
              <span className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink">
                {pending ? <Spinner size="sm" className="text-steel" /> : null}
                {formatMoneyValue(cart.cost.totalAmount)}
              </span>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-steel">
            Shipping and taxes calculated at checkout.
          </p>

          <DiscountCodeForm discountCodes={cart.discountCodes} />

          <CheckoutButton checkoutUrl={cart.checkoutUrl} />

          <Link
            href="/collections/all"
            className="mt-4 flex min-h-11 items-center justify-center text-sm font-medium text-steel underline-offset-4 hover:text-ink hover:underline"
          >
            Continue shopping
          </Link>

          <p className="mt-6 text-center text-xs text-steel">
            Secure checkout via Shopify
          </p>
        </aside>
      </div>

      {recommendations}
    </SiteContainer>
  );
}
