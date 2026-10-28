"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import ProductCard from "@/app/components/product-card";
import SiteContainer from "@/app/components/site-container";
import { formatMoney } from "@/lib/money";
import type { ProductListItem } from "@/lib/products";
import CartLineControls from "./cart-line-controls";
import CheckoutButton from "./checkout-button";
import DiscountCodeForm from "./discount-code-form";

type CartMoney = {
  amount: string;
  currencyCode: string;
};

type DiscountApplication = {
  totalAllocatedAmount: CartMoney;
  code?: string;
  title?: string;
};

type DiscountAllocation = {
  discountedAmount: CartMoney;
  sourceDiscountApplication: {
    code?: string;
    title?: string;
  };
};

export type CartViewLine = {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    image: {
      url: string;
      altText: string | null;
    } | null;
    product: {
      title: string;
      handle: string;
    };
  };
  discountAllocations: DiscountAllocation[];
  cost: {
    amountPerQuantity: CartMoney;
    compareAtAmountPerQuantity: CartMoney | null;
    subtotalAmount: CartMoney;
    totalAmount: CartMoney;
  };
};

type CartViewProps = {
  cart: {
    checkoutUrl: string;
    totalQuantity: number;
    discountCodes: { code: string; applicable: boolean }[];
    discountApplications: DiscountApplication[];
    cost: {
      subtotalAmount: CartMoney;
      totalAmount: CartMoney;
      checkoutChargeAmount: CartMoney;
    };
    lines: CartViewLine[];
  };
  checkoutAllowedHosts?: string[];
  recommendations?: ProductListItem[];
};

function discountLabel(application: DiscountApplication) {
  return application.code ?? application.title ?? "Discount";
}

function allocationLabel(allocation: DiscountAllocation) {
  return (
    allocation.sourceDiscountApplication.code ??
    allocation.sourceDiscountApplication.title ??
    null
  );
}

export default function CartView({
  cart,
  checkoutAllowedHosts = [],
  recommendations = [],
}: CartViewProps) {
  const [quantityOverrides, setQuantityOverrides] = useState<
    Record<string, number>
  >({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [pendingLineIds, setPendingLineIds] = useState<string[]>([]);
  const [discountPending, setDiscountPending] = useState(false);

  const handleLinePendingChange = useCallback(
    (lineId: string, pending: boolean) => {
      setPendingLineIds((current) => {
        if (pending) {
          return current.includes(lineId) ? current : [...current, lineId];
        }
        if (!current.includes(lineId)) {
          return current;
        }
        return current.filter((id) => id !== lineId);
      });
    },
    [],
  );

  const displayLines = useMemo(() => {
    return cart.lines
      .filter((line) => !removedIds.includes(line.id))
      .map((line) => {
        const override = quantityOverrides[line.id];
        const quantity =
          override !== undefined && override !== line.quantity
            ? override
            : line.quantity;
        return {
          ...line,
          quantity,
        };
      });
  }, [cart.lines, quantityOverrides, removedIds]);

  const totalQuantity = displayLines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const discountRows = cart.discountApplications.filter(
    (application) => Number(application.totalAllocatedAmount.amount) > 0,
  );

  const summaryPending = pendingLineIds.length > 0 || discountPending;

  return (
    <SiteContainer boxed className="py-10 sm:py-14 lg:py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-mist pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Your Bag
          </h1>
          <p className="mt-2 text-sm uppercase tracking-[0.12em] text-steel">
            {totalQuantity} item{totalQuantity === 1 ? "" : "s"}
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
          {displayLines.map((line) => {
            const serverLine =
              cart.lines.find((item) => item.id === line.id) ?? line;
            const showVariant =
              line.merchandise.title.trim().toLowerCase() !== "default title";
            const hasLineDiscount =
              serverLine.cost.subtotalAmount.amount !==
              serverLine.cost.totalAmount.amount;
            const compareAt = serverLine.cost.compareAtAmountPerQuantity;
            const showCompareAt =
              compareAt !== null &&
              Number(compareAt.amount) >
                Number(serverLine.cost.amountPerQuantity.amount);
            const allocationNote = serverLine.discountAllocations
              .map(allocationLabel)
              .find(Boolean);
            const linePending = pendingLineIds.includes(line.id);
            const productHref = `/products/${line.merchandise.product.handle}`;

            return (
              <li
                key={line.id}
                className={`grid grid-cols-[7rem_minmax(0,1fr)] gap-4 py-8 transition-opacity sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-8 ${
                  linePending ? "opacity-60" : "opacity-100"
                }`}
              >
                <Link
                  href={productHref}
                  className="relative aspect-[4/5] overflow-hidden bg-mist"
                >
                  {line.merchandise.image ? (
                    <Image
                      src={line.merchandise.image.url}
                      alt={
                        line.merchandise.image.altText ??
                        line.merchandise.product.title
                      }
                      fill
                      sizes="128px"
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

                <div className="min-w-0 space-y-4">
                  <div>
                    <Link
                      href={productHref}
                      className="font-display text-base font-semibold uppercase tracking-wide text-ink hover:underline sm:text-lg"
                    >
                      {line.merchandise.product.title}
                    </Link>
                    {showVariant ? (
                      <p className="mt-1.5 text-sm text-steel">
                        {line.merchandise.title}
                      </p>
                    ) : null}
                    <p className="mt-3 text-sm text-ink">
                      {showCompareAt && compareAt ? (
                        <>
                          <span className="mr-2 text-steel line-through">
                            {formatMoney(
                              compareAt.amount,
                              compareAt.currencyCode,
                            )}
                          </span>
                          <span className="font-medium text-sale">
                            {formatMoney(
                              serverLine.cost.amountPerQuantity.amount,
                              serverLine.cost.amountPerQuantity.currencyCode,
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="font-medium">
                          {formatMoney(
                            serverLine.cost.amountPerQuantity.amount,
                            serverLine.cost.amountPerQuantity.currencyCode,
                          )}
                        </span>
                      )}
                    </p>
                    {allocationNote ? (
                      <p className="mt-1 text-xs text-steel">
                        Includes {allocationNote}
                      </p>
                    ) : null}
                  </div>

                  <CartLineControls
                    lineId={line.id}
                    productTitle={line.merchandise.product.title}
                    quantity={line.quantity}
                    serverQuantity={serverLine.quantity}
                    onQuantityOptimistic={(id, quantity) =>
                      setQuantityOverrides((current) => ({
                        ...current,
                        [id]: quantity,
                      }))
                    }
                    onQuantityRollback={(id) =>
                      setQuantityOverrides((current) => {
                        const next = { ...current };
                        delete next[id];
                        return next;
                      })
                    }
                    onRemoveOptimistic={(id) =>
                      setRemovedIds((current) =>
                        current.includes(id) ? current : [...current, id],
                      )
                    }
                    onRemoveRollback={(id) =>
                      setRemovedIds((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                    onPendingChange={(pending) =>
                      handleLinePendingChange(line.id, pending)
                    }
                  />
                </div>

                <div className="col-span-2 text-right sm:col-span-1 sm:pt-1">
                  {hasLineDiscount ? (
                    <p className="font-display text-base font-semibold text-ink">
                      <span className="mr-2 text-sm font-normal text-steel line-through">
                        {formatMoney(
                          serverLine.cost.subtotalAmount.amount,
                          serverLine.cost.subtotalAmount.currencyCode,
                        )}
                      </span>
                      {formatMoney(
                        serverLine.cost.totalAmount.amount,
                        serverLine.cost.totalAmount.currencyCode,
                      )}
                    </p>
                  ) : (
                    <p className="font-display text-base font-semibold text-ink">
                      {formatMoney(
                        serverLine.cost.totalAmount.amount,
                        serverLine.cost.totalAmount.currencyCode,
                      )}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="border-t border-mist pt-8 lg:sticky lg:top-28 lg:border-t-0 lg:bg-mist/35 lg:px-6 lg:py-7 lg:pt-7">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink">
            Summary
          </h2>

          <div
            className={`mt-6 space-y-3 text-sm transition-opacity ${
              summaryPending ? "opacity-60" : "opacity-100"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="text-steel">Subtotal</span>
              <span className="font-medium text-ink">
                {formatMoney(
                  cart.cost.subtotalAmount.amount,
                  cart.cost.subtotalAmount.currencyCode,
                )}
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
                <span className="font-medium text-ink">
                  −
                  {formatMoney(
                    application.totalAllocatedAmount.amount,
                    application.totalAllocatedAmount.currencyCode,
                  )}
                </span>
              </div>
            ))}

            <div className="flex items-center justify-between gap-4 border-t border-mist pt-4">
              <span className="font-display text-base font-semibold text-ink">
                Estimated total
              </span>
              <span className="font-display text-base font-semibold text-ink">
                {formatMoney(
                  cart.cost.totalAmount.amount,
                  cart.cost.totalAmount.currencyCode,
                )}
              </span>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-steel">
            Shipping and taxes calculated at checkout.
          </p>

          <DiscountCodeForm
            discountCodes={cart.discountCodes}
            onPendingChange={setDiscountPending}
          />

          <CheckoutButton
            checkoutUrl={cart.checkoutUrl}
            allowedHost={checkoutAllowedHosts}
          />

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

      {recommendations.length > 0 ? (
        <section className="mt-16 border-t border-mist pt-12 sm:mt-20 sm:pt-16">
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-ink sm:text-2xl">
            You may also like
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {recommendations.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}
    </SiteContainer>
  );
}
