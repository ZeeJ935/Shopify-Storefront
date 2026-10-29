"use client";

import { useState } from "react";
import { useCart } from "@/app/components/cart-provider";
import Spinner from "@/app/components/spinner";
import { useDelayedPending } from "@/app/hooks/use-delayed-pending";

type CartLineControlsProps = {
  lineId: string;
  productTitle: string;
  quantity: number;
};

export default function CartLineControls({
  lineId,
  productTitle,
  quantity,
}: CartLineControlsProps) {
  const { setQuantity, removeLine, pendingLineIds, lineErrors } = useCart();
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const showPending = useDelayedPending(pendingLineIds.has(lineId));
  const error = lineErrors[lineId] ?? null;

  const inputValue = draftValue ?? String(quantity);

  function changeQuantity(next: number) {
    setDraftValue(null);
    if (!Number.isFinite(next)) {
      return;
    }
    const clamped = Math.min(99, Math.max(1, Math.trunc(next)));
    if (clamped === quantity) {
      return;
    }
    setQuantity(lineId, clamped);
    setAnnouncement(`Quantity updated to ${clamped} for ${productTitle}.`);
  }

  function handleRemove() {
    removeLine(lineId);
    setAnnouncement(`${productTitle} removed from cart.`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="inline-flex items-center border border-mist bg-snow"
          role="group"
          aria-label={`Quantity for ${productTitle}`}
        >
          <button
            type="button"
            onClick={() => changeQuantity(quantity - 1)}
            disabled={quantity <= 1}
            aria-label={`Decrease quantity of ${productTitle}`}
            className="inline-flex h-11 w-11 items-center justify-center text-base text-ink transition-colors hover:bg-mist/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <input
            id={`quantity-${lineId}`}
            type="number"
            min={1}
            max={99}
            value={inputValue}
            aria-label={`Quantity of ${productTitle}`}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={() => changeQuantity(Number(inputValue))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="h-11 w-12 border-x border-mist bg-transparent text-center text-sm font-medium text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => changeQuantity(quantity + 1)}
            disabled={quantity >= 99}
            aria-label={`Increase quantity of ${productTitle}`}
            className="inline-flex h-11 w-11 items-center justify-center text-base text-ink transition-colors hover:bg-mist/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>

        {showPending ? <Spinner size="sm" className="text-steel" /> : null}

        <button
          type="button"
          onClick={handleRemove}
          className="inline-flex min-h-11 items-center text-sm font-medium uppercase tracking-wide text-steel underline-offset-4 transition-colors hover:text-danger hover:underline"
        >
          Remove
        </button>
      </div>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
