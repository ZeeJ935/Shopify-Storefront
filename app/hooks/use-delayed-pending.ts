"use client";

import { useEffect, useState } from "react";

const DEFAULT_DELAY_MS = 150;

/**
 * Returns true only after `isPending` has been true for `delayMs`.
 * Clears immediately when `isPending` becomes false (via short async reset).
 */
export function useDelayedPending(
  isPending: boolean,
  delayMs: number = DEFAULT_DELAY_MS,
) {
  const [showPending, setShowPending] = useState(false);

  useEffect(() => {
    if (!isPending) {
      const clearId = window.setTimeout(() => {
        setShowPending(false);
      }, 0);
      return () => {
        window.clearTimeout(clearId);
      };
    }

    const showId = window.setTimeout(() => {
      setShowPending(true);
    }, delayMs);

    return () => {
      window.clearTimeout(showId);
    };
  }, [isPending, delayMs]);

  return isPending && showPending;
}
