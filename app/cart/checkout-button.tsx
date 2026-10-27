"use client";

import { useState } from "react";
import PendingButtonLabel from "@/app/components/pending-button-label";
import { isSafeShopifyCheckoutUrl } from "@/lib/checkout-url";

type CheckoutButtonProps = {
  checkoutUrl: string;
  allowedHost?: string | string[] | null;
};

export default function CheckoutButton({
  checkoutUrl,
  allowedHost,
}: CheckoutButtonProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safe = isSafeShopifyCheckoutUrl(checkoutUrl, allowedHost);

  function handleClick() {
    if (redirecting) {
      return;
    }

    if (!safe) {
      setError("Checkout is unavailable right now. Please try again later.");
      return;
    }

    setError(null);
    setRedirecting(true);
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
          {error ??
            "Checkout is unavailable right now. Please try again later."}
        </p>
      ) : null}
    </div>
  );
}
