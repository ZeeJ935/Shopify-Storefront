"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import CartLineItem from "@/app/cart/cart-line-item";
import CheckoutButton from "@/app/cart/checkout-button";
import { formatMoneyValue } from "@/lib/money";
import { useCart } from "./cart-provider";
import Skeleton from "./skeleton";
import Spinner from "./spinner";

export default function CartDrawer() {
  const {
    cart,
    status,
    pending,
    pendingLineIds,
    drawerOpen,
    closeDrawer,
    ensureLoaded,
  } = useCart();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (drawerOpen) {
      ensureLoaded();
    }
  }, [drawerOpen, ensureLoaded]);

  useEffect(() => {
    if (!drawerOpen || !panelRef.current) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    document.body.classList.add("is-scroll-locked");
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;

      // Lines can be added or removed while open, so query focusables per keypress.
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-scroll-locked");
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [drawerOpen, closeDrawer]);

  if (!drawerOpen) return null;

  const lines = cart?.lines ?? [];
  const loading = status !== "ready";

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close bag"
        tabIndex={-1}
        onClick={closeDrawer}
      />
      <div
        ref={panelRef}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-snow shadow-lg"
      >
        <div className="flex items-center justify-between gap-4 border-b border-mist px-4 py-4 sm:px-6">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
            Your Bag
            {cart && cart.totalQuantity > 0 ? (
              <span className="ml-2 text-sm font-normal text-steel">
                ({cart.totalQuantity})
              </span>
            ) : null}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-2xl"
            aria-label="Close"
            onClick={closeDrawer}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6">
          {loading ? (
            <ul className="divide-y divide-mist" aria-busy="true" aria-label="Loading bag">
              {Array.from({ length: 2 }).map((_, index) => (
                <li key={index} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 py-5">
                  <Skeleton className="aspect-[4/5] w-full" />
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-11 w-36" />
                  </div>
                </li>
              ))}
            </ul>
          ) : lines.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-base text-steel">Your bag is empty.</p>
              <Link
                href="/collections/all"
                className="btn btn-primary mt-6"
                onClick={closeDrawer}
              >
                Continue shopping
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-mist">
              {lines.map((line) => (
                <CartLineItem
                  key={line.id}
                  line={line}
                  pending={pendingLineIds.has(line.id)}
                  compact
                  onNavigate={closeDrawer}
                />
              ))}
            </ul>
          )}
        </div>

        {cart && lines.length > 0 ? (
          <div className="border-t border-mist px-4 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-steel">Subtotal</span>
              <span className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink">
                {pending ? <Spinner size="sm" className="text-steel" /> : null}
                {formatMoneyValue(cart.cost.subtotalAmount)}
              </span>
            </div>
            <p className="mt-2 text-xs text-steel">
              Before discounts. Shipping and taxes calculated at checkout.
            </p>
            <CheckoutButton checkoutUrl={cart.checkoutUrl} />
            <Link
              href="/cart"
              className="mt-3 flex min-h-11 items-center justify-center text-sm font-medium text-steel underline-offset-4 hover:text-ink hover:underline"
              onClick={closeDrawer}
            >
              View bag
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
