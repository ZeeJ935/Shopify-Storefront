"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
            Your cart
          </h1>
          <p className="mt-2 text-sm text-steel">
            {totalQuantity} item{totalQuantity === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/#catalog"
          className="inline-flex min-h-11 items-center text-sm font-medium text-steel hover:text-ink hover:underline"
        >
          ← Continue shopping
        </Link>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:items-start lg:gap-12">
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
            const allocationNote = serverLine.discountAllocations
              .map(allocationLabel)
              .find(Boolean);
            const linePending = pendingLineIds.includes(line.id);

            return (
              <li
                key={line.id}
                className={`grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 py-6 transition-opacity sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:gap-6 ${
                  linePending ? "opacity-60" : "opacity-100"
                }`}
              >
                <div className="relative aspect-square overflow-hidden rounded bg-mist">
                  {line.merchandise.image ? (
                    <Image
                      src={line.merchandise.image.url}
                      alt={
                        line.merchandise.image.altText ??
                        line.merchandise.product.title
                      }
                      fill
                      sizes="104px"
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
                </div>

                <div className="min-w-0 space-y-3">
                  <div>
                    <Link
                      href={`/products/${line.merchandise.product.handle}`}
                      className="font-display text-base font-semibold text-ink hover:underline sm:text-lg"
                    >
                      {line.merchandise.product.title}
                    </Link>
                    {showVariant && (
                      <p className="mt-1 text-sm text-steel">
                        {line.merchandise.title}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-steel">
                      {compareAt &&
                      compareAt.amount !==
                        serverLine.cost.amountPerQuantity.amount ? (
                        <>
                          <span className="mr-2 line-through">
                            {formatMoney(
                              compareAt.amount,
                              compareAt.currencyCode,
                            )}
                          </span>
                          {formatMoney(
                            serverLine.cost.amountPerQuantity.amount,
                            serverLine.cost.amountPerQuantity.currencyCode,
                          )}{" "}
                          each
                        </>
                      ) : (
                        <>
                          {formatMoney(
                            serverLine.cost.amountPerQuantity.amount,
                            serverLine.cost.amountPerQuantity.currencyCode,
                          )}{" "}
                          each
                        </>
                      )}
                    </p>
                    {allocationNote && (
                      <p className="mt-1 text-xs text-steel">
                        Includes {allocationNote}
                      </p>
                    )}
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
                    <p className="font-medium text-ink">
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
                    <p className="font-medium text-ink">
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

        <aside className="rounded border border-mist bg-white p-5 lg:sticky lg:top-24">
          <h2 className="font-display text-lg font-semibold text-ink">
            Order summary
          </h2>

          <div
            className={`mt-5 space-y-3 text-sm transition-opacity ${
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

            <div className="flex items-center justify-between gap-4 border-t border-mist pt-3">
              <span className="font-medium text-ink">Estimated total</span>
              <span className="font-semibold text-ink">
                {formatMoney(
                  cart.cost.totalAmount.amount,
                  cart.cost.totalAmount.currencyCode,
                )}
              </span>
            </div>
          </div>

          <DiscountCodeForm
            discountCodes={cart.discountCodes}
            onPendingChange={setDiscountPending}
          />

          <p className="mt-4 text-sm text-steel">
            Shipping and taxes calculated at checkout.
          </p>
          <CheckoutButton
            checkoutUrl={cart.checkoutUrl}
            allowedHost={checkoutAllowedHosts}
          />
        </aside>
      </div>
    </div>
  );
}
