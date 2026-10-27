"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Spinner from "@/app/components/spinner";
import { useDelayedPending } from "@/app/hooks/use-delayed-pending";
import { removeItem, updateItem } from "./actions";

type CartLineControlsProps = {
  lineId: string;
  productTitle: string;
  quantity: number;
  serverQuantity: number;
  onQuantityOptimistic: (lineId: string, quantity: number) => void;
  onQuantityRollback: (lineId: string) => void;
  onRemoveOptimistic: (lineId: string) => void;
  onRemoveRollback: (lineId: string) => void;
  onPendingChange?: (pending: boolean) => void;
};

const DEBOUNCE_MS = 350;

export default function CartLineControls({
  lineId,
  productTitle,
  quantity: displayQuantity,
  serverQuantity,
  onQuantityOptimistic,
  onQuantityRollback,
  onRemoveOptimistic,
  onRemoveRollback,
  onPendingChange,
}: CartLineControlsProps) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, startTransition] = useTransition();
  const showPending = useDelayedPending(isPending);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const onPendingChangeRef = useRef(onPendingChange);

  const inputValue = draftValue ?? String(displayQuantity);

  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    onPendingChangeRef.current?.(isPending);
    return () => {
      onPendingChangeRef.current?.(false);
    };
  }, [isPending]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function clearDebounce() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function scheduleUpdate(nextQuantity: number) {
    const clamped = Math.min(99, Math.max(1, Math.trunc(nextQuantity)));
    setDraftValue(null);
    setError(null);
    onQuantityOptimistic(lineId, clamped);

    if (clamped === serverQuantity) {
      clearDebounce();
      onQuantityRollback(lineId);
      return;
    }

    clearDebounce();
    const requestId = ++requestIdRef.current;
    setAnnouncement(`Updating cart…`);

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await updateItem(lineId, clamped);

        if (requestId !== requestIdRef.current) {
          return;
        }

        if (result.success) {
          setAnnouncement(
            `Quantity updated to ${clamped} for ${productTitle}.`,
          );
        } else {
          onQuantityRollback(lineId);
          setDraftValue(null);
          setError(result.message);
          setAnnouncement(`Could not update quantity for ${productTitle}.`);
        }
      });
    }, DEBOUNCE_MS);
  }

  function handleDecrease() {
    if (isPending || displayQuantity <= 1) {
      return;
    }
    scheduleUpdate(displayQuantity - 1);
  }

  function handleIncrease() {
    if (isPending || displayQuantity >= 99) {
      return;
    }
    scheduleUpdate(displayQuantity + 1);
  }

  function commitTypedQuantity() {
    const next = Number(inputValue);
    setDraftValue(null);
    if (!Number.isFinite(next)) {
      return;
    }
    scheduleUpdate(next);
  }

  function handleRemove() {
    if (isPending) {
      return;
    }

    clearDebounce();
    requestIdRef.current += 1;
    setError(null);
    setAnnouncement(`Updating cart…`);
    onRemoveOptimistic(lineId);

    startTransition(async () => {
      const result = await removeItem(lineId);

      if (result.success) {
        setAnnouncement(`${productTitle} removed from cart.`);
      } else {
        onRemoveRollback(lineId);
        setError(result.message);
        setAnnouncement(`Could not remove ${productTitle}.`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="inline-flex items-center border border-mist bg-snow"
          role="group"
          aria-label={`Quantity for ${productTitle}`}
          aria-busy={isPending}
        >
          <button
            type="button"
            onClick={handleDecrease}
            disabled={isPending || displayQuantity <= 1}
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
            disabled={isPending}
            aria-label={`Quantity of ${productTitle}`}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={commitTypedQuantity}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="h-11 w-12 border-x border-mist bg-transparent text-center text-sm font-medium text-ink [appearance:textfield] disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={handleIncrease}
            disabled={isPending || displayQuantity >= 99}
            aria-label={`Increase quantity of ${productTitle}`}
            className="inline-flex h-11 w-11 items-center justify-center text-base text-ink transition-colors hover:bg-mist/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>

        {showPending ? (
          <Spinner size="sm" className="text-steel" />
        ) : null}

        <button
          type="button"
          onClick={handleRemove}
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex min-h-11 items-center text-sm font-medium uppercase tracking-wide text-steel underline-offset-4 transition-colors hover:text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-50"
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
