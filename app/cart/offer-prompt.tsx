"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/app/components/cart-provider";
import PendingButtonLabel from "@/app/components/pending-button-label";
import type { OfferHint } from "@/lib/offer-hint";
import { getCartOfferHint } from "./actions";

type OfferPromptProps = {
  /** Computed on the server for the first render. */
  initialHint: OfferHint | null;
  /** Changes whenever Shopify confirms a cart change; the hint is re-read then. */
  cartUpdatedAt: string;
  pending: boolean;
};

/** "Buy 2 get 1 free: add 1 more eligible item — the cheapest one is free." */
export default function OfferPrompt({ initialHint, cartUpdatedAt, pending }: OfferPromptProps) {
  const { addItem } = useCart();
  const [hint, setHint] = useState(initialHint);
  const [adding, setAdding] = useState(false);
  const seen = useRef(cartUpdatedAt);

  useEffect(() => {
    if (pending || seen.current === cartUpdatedAt) return;
    seen.current = cartUpdatedAt;
    let cancelled = false;
    void getCartOfferHint()
      .then((next) => {
        if (!cancelled) setHint(next);
      })
      .catch(() => {
        if (!cancelled) setHint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cartUpdatedAt, pending]);

  if (!hint) return null;

  async function handleAdd() {
    if (!hint?.add || adding) return;
    setAdding(true);
    try {
      await addItem(hint.add.variantId, 1);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div role="status" className="mb-8 border border-ink/15 bg-mist/35 px-5 py-4">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-ink">
        {hint.title}
      </p>
      <p className="mt-1 text-sm text-steel">{hint.message}</p>
      {hint.add ? (
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || pending}
          className="btn btn-secondary mt-3 min-h-11 rounded-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PendingButtonLabel
            pending={adding}
            idleLabel={`Add another ${hint.add.title}`}
            pendingLabel="Adding…"
          />
        </button>
      ) : null}
    </div>
  );
}
