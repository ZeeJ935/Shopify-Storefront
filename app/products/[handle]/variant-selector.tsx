"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useCart } from "@/app/components/cart-provider";
import PendingButtonLabel from "@/app/components/pending-button-label";
import { useDelayedPending } from "@/app/hooks/use-delayed-pending";
import { formatMoneyValue } from "@/lib/money";
import type { ProductVariant } from "@/lib/products";
import { isBackorder, lowStockCount, maxPurchasable } from "@/lib/stock";

type VariantSelectorProps = {
  variants: ProductVariant[];
};

function variantLabel(variant: ProductVariant) {
  return variant.availableForSale
    ? variant.title
    : `${variant.title} — Sold out`;
}

export default function VariantSelector({ variants }: VariantSelectorProps) {
  const firstAvailable =
    variants.find((variant) => variant.availableForSale) ?? null;

  const [selectedVariantId, setSelectedVariantId] = useState(
    firstAvailable?.id ?? variants[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState(1);
  const { addItem, cart, ensureLoaded } = useCart();
  const [isPending, startTransition] = useTransition();
  const showPending = useDelayedPending(isPending);
  const [feedback, setFeedback] = useState<{
    type: "success" | "notice" | "error";
    message: string;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const listboxId = useId();
  const labelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) ?? null,
    [variants, selectedVariantId],
  );

  const hasAvailableVariant = variants.some(
    (variant) => variant.availableForSale,
  );
  // Shopify names the only variant of an option-less product "Default Title".
  const showPicker = !(
    variants.length === 1 && variants[0].title === "Default Title"
  );
  // What's already in the bag counts against stock. If the cart hasn't loaded
  // on this page yet, Shopify's cart warnings still cap the add.
  const inBag =
    cart?.lines
      .filter((line) => line.merchandise.id === selectedVariant?.id)
      .reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const remaining = selectedVariant
    ? Math.max(0, maxPurchasable(selectedVariant) - inBag)
    : 0;
  const addQuantity = Math.min(quantity, Math.max(1, remaining));
  const lowStock = selectedVariant ? lowStockCount(selectedVariant) : null;

  // Only when stock is low can what's already in the bag noticeably cap this
  // add, so only then is the cart worth a fetch. Otherwise Shopify's cart
  // warnings still enforce the real limit.
  const needsCart = lowStock !== null;
  useEffect(() => {
    if (needsCart) {
      ensureLoaded();
    }
  }, [needsCart, ensureLoaded]);
  const allInBag =
    selectedVariant?.availableForSale === true && inBag > 0 && remaining === 0;

  const canAddToCart =
    Boolean(selectedVariant?.id) &&
    selectedVariant?.availableForSale === true &&
    remaining > 0 &&
    !isPending;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    optionRefs.current[activeIndex]?.focus();
  }, [isOpen, activeIndex]);

  if (variants.length === 0 || !hasAvailableVariant) {
    return (
      <div className="mt-8 space-y-3 rounded border border-mist bg-white p-4">
        <p className="text-sm font-medium text-danger">Currently unavailable</p>
        <p className="text-sm text-steel">
          This product has no variants available for purchase right now.
        </p>
      </div>
    );
  }

  function openListbox() {
    const selectedIndex = Math.max(
      0,
      variants.findIndex((variant) => variant.id === selectedVariantId),
    );
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }

  function selectVariant(variant: ProductVariant) {
    if (!variant.availableForSale) {
      return;
    }
    setSelectedVariantId(variant.id);
    setFeedback(null);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (variants.length === 0) {
      return;
    }

    let next = activeIndex;
    for (let step = 0; step < variants.length; step += 1) {
      next = (next + delta + variants.length) % variants.length;
      if (variants[next]?.availableForSale) {
        setActiveIndex(next);
        return;
      }
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        openListbox();
      }
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(
          Math.max(
            0,
            variants.findIndex((variant) => variant.availableForSale),
          ),
        );
        break;
      case "End": {
        event.preventDefault();
        let last = -1;
        for (let i = variants.length - 1; i >= 0; i -= 1) {
          if (variants[i]?.availableForSale) {
            last = i;
            break;
          }
        }
        if (last >= 0) {
          setActiveIndex(last);
        }
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        const variant = variants[activeIndex];
        if (variant) {
          selectVariant(variant);
        }
        break;
      }
      case "Tab":
        setIsOpen(false);
        break;
      default:
        break;
    }
  }

  function handleAddToCart() {
    if (!selectedVariant?.id || !canAddToCart) {
      return;
    }

    setFeedback(null);

    startTransition(async () => {
      const result = await addItem(selectedVariant.id, addQuantity);

      if (result.success && result.notices.length > 0) {
        // Stock capped the add; say so here as well as in the drawer.
        setFeedback({ type: "notice", message: result.notices[0].message });
      } else if (result.success) {
        // The cart drawer opens with the item; this line is for screen readers.
        setFeedback({
          type: "success",
          message: `Added to cart. Your cart now has ${result.cart.totalQuantity} item${result.cart.totalQuantity === 1 ? "" : "s"}.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: result.message,
        });
      }
    });
  }

  return (
    <div className="mt-8 space-y-5 overflow-visible">
      <div ref={containerRef} className="relative overflow-visible">
        {showPicker ? (
          <>
            <span id={labelId} className="mb-2 block text-sm font-medium text-ink">
              Select variant
            </span>

            <button
              ref={triggerRef}
              type="button"
              className="field flex w-full items-center justify-between gap-3 text-left"
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-labelledby={labelId}
              disabled={isPending}
              onClick={() => {
                if (isOpen) {
                  setIsOpen(false);
                } else {
                  openListbox();
                }
              }}
              onKeyDown={handleTriggerKeyDown}
            >
              <span className="min-w-0 truncate">
                {selectedVariant ? variantLabel(selectedVariant) : "Select a variant"}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-4 w-4 shrink-0 text-steel transition ${isOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {isOpen && (
              <div
                id={listboxId}
                role="listbox"
                aria-labelledby={labelId}
                tabIndex={-1}
                onKeyDown={handleListKeyDown}
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded border border-mist bg-snow py-1 shadow-[0_8px_24px_rgba(11,18,32,0.12)]"
              >
                {variants.map((variant, index) => {
                  const selected = variant.id === selectedVariantId;
                  const disabled = !variant.availableForSale;
                  const active = index === activeIndex;

                  return (
                    <button
                      key={variant.id}
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-disabled={disabled || undefined}
                      disabled={disabled}
                      tabIndex={active ? 0 : -1}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm ${
                        disabled
                          ? "cursor-not-allowed text-steel/70"
                          : "text-ink hover:bg-mist/70"
                      } ${active && !disabled ? "bg-mist/80" : ""} ${
                        selected && !disabled ? "font-semibold" : "font-normal"
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectVariant(variant)}
                    >
                      <span>{variantLabel(variant)}</span>
                      {selected && !disabled ? (
                        <span className="text-xs font-medium text-steel" aria-hidden="true">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : null}

        <p
          className={`mt-2 text-sm ${lowStock !== null ? "font-medium text-sale" : "text-steel"}`}
          aria-live="polite"
        >
          {!selectedVariant?.availableForSale
            ? "Sold out"
            : isBackorder(selectedVariant)
              ? "Available on backorder. Ships when back in stock."
              : lowStock !== null
                ? `Only ${lowStock} left`
                : "In stock"}
        </p>
      </div>

      {selectedVariant && (
        <div className="space-y-1">
          <p className="font-display text-2xl font-semibold text-ink">
            {formatMoneyValue(selectedVariant.price)}
          </p>
          {selectedVariant.compareAtPrice &&
            Number(selectedVariant.compareAtPrice.amount) >
              Number(selectedVariant.price.amount) && (
              <p className="text-sm text-steel line-through">
                {formatMoneyValue(selectedVariant.compareAtPrice)}
              </p>
            )}
          {selectedVariant.selectedOptions.length > 0 && (
            <p className="text-sm text-steel">
              {selectedVariant.selectedOptions
                .map((option) => `${option.name}: ${option.value}`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      <div>
        <label
          htmlFor="quantity"
          className="mb-2 block text-sm font-medium text-ink"
        >
          Quantity
        </label>
        <input
          id="quantity"
          type="number"
          min={1}
          max={Math.max(1, remaining)}
          value={addQuantity}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) {
              return;
            }
            setQuantity(Math.min(Math.max(1, remaining), Math.max(1, Math.trunc(next))));
          }}
          className="field max-w-[8rem]"
          disabled={isPending || remaining === 0}
        />
        {allInBag ? (
          <p className="mt-2 text-sm text-steel">
            You have all {inBag} available in your bag.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={handleAddToCart}
        disabled={!canAddToCart}
        aria-busy={isPending}
        className="btn btn-primary w-full min-w-[10rem] sm:w-auto"
      >
        <PendingButtonLabel
          pending={showPending}
          idleLabel="Add to cart"
          pendingLabel="Adding…"
        />
      </button>

      <div role="status" aria-live="polite" className="min-h-5">
        {feedback?.type === "error" && (
          <p className="text-sm text-danger">{feedback.message}</p>
        )}
        {feedback?.type === "notice" && (
          <p className="text-sm text-steel">{feedback.message}</p>
        )}
        {feedback?.type === "success" && (
          <p className="sr-only">{feedback.message}</p>
        )}
      </div>
    </div>
  );
}
