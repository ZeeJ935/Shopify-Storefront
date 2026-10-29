"use client";

import { useState } from "react";
import { useCart } from "@/app/components/cart-provider";
import PendingButtonLabel from "@/app/components/pending-button-label";

type CheckoutButtonProps = {
  /** Already host-checked on the server (`toClientCart`); blank when unsafe. */
  checkoutUrl: string;
};

const UNAVAILABLE_MESSAGE =
  "Checkout is unavailable right now. Please try again later.";

export default function CheckoutButton({ checkoutUrl }: CheckoutButtonProps) {
  const { flush } = useCart();
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safe = checkoutUrl.startsWith("https://");

  async function handleClick() {
    if (redirecting) {
      return;
    }

    if (!safe) {
      setError(UNAVAILABLE_MESSAGE);
      return;
    }

    setError(null);
    setRedirecting(true);

    // Never send the shopper to checkout with quantities Shopify hasn't saved.
    const saved = await flush();
    if (!saved) {
      setRedirecting(false);
      setError("Your bag couldn't be updated. Please review it and try again.");
      return;
    }

    window.location.assign(checkoutUrl);
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handleClick}
        disabled={redirecting || !safe}
        aria-busy={redirecting}
        className="btn btn-primary w-full"
      >
        <PendingButtonLabel
          pending={redirecting}
          idleLabel="Proceed to Checkout"
          pendingLabel="Redirecting…"
        />
      </button>
      {error || !safe ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error ?? UNAVAILABLE_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
