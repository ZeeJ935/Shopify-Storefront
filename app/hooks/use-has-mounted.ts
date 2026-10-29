"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during the server render and hydration, true after.
 *
 * Gate client-only state (favourites, the live cart) behind this when it
 * drives attributes. A section that hydrates late can otherwise see loaded
 * state on its first client render, mismatch the server HTML, and keep the
 * stale attribute: React doesn't patch attributes during hydration. Reading
 * this re-renders right after hydration, as a normal update.
 */
export function useHasMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
