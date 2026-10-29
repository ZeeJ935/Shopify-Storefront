"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addItem as addItemAction,
  applyDiscountCode,
  getCurrentCart,
  removeDiscountCode,
  removeItem as removeItemAction,
  updateItems,
  type CartActionResult,
} from "@/app/cart/actions";
import type { Cart } from "@/lib/cart";
import { multiplyMoney, sumMoney } from "@/lib/money";
import { useStorefrontToast } from "./storefront-toast";

const DEBOUNCE_MS = 350;

/** idle: never loaded on the client; ready: `confirmed` reflects the server (null = no cart). */
type CartStatus = "idle" | "loading" | "ready";

type CartContextValue = {
  /** Confirmed server cart with pending quantity edits and removals applied. */
  cart: Cart | null;
  status: CartStatus;
  /** True while any edit is waiting to be sent or confirmed. */
  pending: boolean;
  pendingLineIds: ReadonlySet<string>;
  lineErrors: Readonly<Record<string, string>>;
  /** Accepts a server-rendered cart unless the client already holds a newer one. */
  seed: (cart: Cart | null) => void;
  /** Fetches the cart once if nothing has loaded it yet (e.g. drawer opened first). */
  ensureLoaded: () => void;
  setQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  addItem: (variantId: string, quantity: number) => Promise<CartActionResult>;
  applyDiscount: (code: string) => Promise<CartActionResult>;
  removeDiscount: (code: string) => Promise<CartActionResult>;
  /** Sends pending edits now and waits for the queue; false if any edit failed. */
  flush: () => Promise<boolean>;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const NETWORK_FAILURE: CartActionResult = {
  success: false,
  message: "Unable to reach the store. Check your connection and try again.",
};

async function safely(
  action: () => Promise<CartActionResult>,
): Promise<CartActionResult> {
  try {
    return await action();
  } catch {
    return NETWORK_FAILURE;
  }
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
}

function isNewer(candidate: Cart, current: Cart) {
  return Date.parse(candidate.updatedAt) > Date.parse(current.updatedAt);
}

function applyPendingEdits(
  cart: Cart,
  overrides: Record<string, number>,
  removedIds: string[],
): Cart {
  if (Object.keys(overrides).length === 0 && removedIds.length === 0) {
    return cart;
  }

  const lines = cart.lines
    .filter((line) => !removedIds.includes(line.id))
    .map((line) => {
      const quantity = overrides[line.id];
      if (quantity === undefined || quantity === line.quantity) {
        return line;
      }

      const subtotalAmount = multiplyMoney(
        line.cost.amountPerQuantity,
        quantity,
      );
      // Discounted totals are only known once Shopify recalculates.
      const totalAmount =
        line.discountAllocations.length > 0
          ? line.cost.totalAmount
          : subtotalAmount;

      return {
        ...line,
        quantity,
        cost: { ...line.cost, subtotalAmount, totalAmount },
      };
    });

  const currency = cart.cost.subtotalAmount.currencyCode;
  const subtotalAmount = sumMoney(
    lines.map((line) => line.cost.subtotalAmount),
    currency,
  );
  // Shift the server total by the subtotal change; discounts settle on confirm.
  const totalAmount = sumMoney(
    [
      cart.cost.totalAmount,
      subtotalAmount,
      multiplyMoney(cart.cost.subtotalAmount, -1),
    ],
    currency,
  );

  return {
    ...cart,
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    cost: { ...cart.cost, subtotalAmount, totalAmount },
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useStorefrontToast();
  const [confirmed, setConfirmed] = useState<Cart | null>(null);
  const [status, setStatus] = useState<CartStatus>("idle");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [inFlight, setInFlight] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const confirmedRef = useRef<Cart | null>(null);
  const statusRef = useRef<CartStatus>("idle");
  // Quantity edits not yet handed to the queue, keyed by line id.
  const dirtyRef = useRef(new Map<string, number>());
  const debounceRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const inFlightRef = useRef(0);
  const failuresRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const commit = useCallback((cart: Cart | null) => {
    confirmedRef.current = cart;
    statusRef.current = "ready";
    setConfirmed(cart);
    setStatus("ready");
    // Drop overrides the server now agrees with, or whose line is gone.
    setOverrides((prev) => {
      let next = prev;
      for (const [id, quantity] of Object.entries(prev)) {
        const line = cart?.lines.find((item) => item.id === id);
        if (!line || line.quantity === quantity) {
          next = withoutKey(next, id);
        }
      }
      return next;
    });
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>) => {
    inFlightRef.current += 1;
    setInFlight((count) => count + 1);

    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => undefined);

    return run.finally(() => {
      inFlightRef.current -= 1;
      setInFlight((count) => count - 1);
    });
  }, []);

  const fail = useCallback(
    (result: Extract<CartActionResult, { success: false }>) => {
      failuresRef.current += 1;
      if (result.cartGone) {
        dirtyRef.current.clear();
        setOverrides({});
        setRemovedIds([]);
        commit(null);
        pushToast(result.message, "error");
      }
    },
    [commit, pushToast],
  );

  const sendDirty = useCallback(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (dirtyRef.current.size === 0) {
      return;
    }

    const snapshot = new Map(dirtyRef.current);
    dirtyRef.current.clear();

    void enqueue(async () => {
      // Earlier queued writes have settled, so this compares against the latest server cart.
      const current = confirmedRef.current;
      const lines = [...snapshot]
        .filter(([id, quantity]) => {
          const line = current?.lines.find((item) => item.id === id);
          return line !== undefined && line.quantity !== quantity;
        })
        .map(([id, quantity]) => ({ id, quantity }));

      if (lines.length === 0) {
        commit(current);
        return;
      }

      const result = await safely(() => updateItems(lines));

      if (result.success) {
        commit(result.cart);
        return;
      }

      fail(result);
      if (result.cartGone) {
        return;
      }

      // Roll back lines that have no newer edit waiting.
      const ids = lines.map((line) => line.id);
      setOverrides((prev) =>
        ids.reduce(
          (next, id) => (dirtyRef.current.has(id) ? next : withoutKey(next, id)),
          prev,
        ),
      );
      setLineErrors((prev) => ({
        ...prev,
        ...Object.fromEntries(ids.map((id) => [id, result.message])),
      }));
    });
  }, [commit, enqueue, fail]);

  const setQuantity = useCallback(
    (lineId: string, quantity: number) => {
      if (!Number.isFinite(quantity)) {
        return;
      }
      const clamped = Math.min(99, Math.max(1, Math.trunc(quantity)));

      dirtyRef.current.set(lineId, clamped);
      setOverrides((prev) =>
        prev[lineId] === clamped ? prev : { ...prev, [lineId]: clamped },
      );
      setLineErrors((prev) => withoutKey(prev, lineId));

      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(sendDirty, DEBOUNCE_MS);
    },
    [sendDirty],
  );

  const removeLine = useCallback(
    (lineId: string) => {
      dirtyRef.current.delete(lineId);
      setOverrides((prev) => withoutKey(prev, lineId));
      setLineErrors((prev) => withoutKey(prev, lineId));
      setRemovedIds((prev) =>
        prev.includes(lineId) ? prev : [...prev, lineId],
      );

      void enqueue(async () => {
        const result = await safely(() => removeItemAction(lineId));
        setRemovedIds((prev) => prev.filter((id) => id !== lineId));

        if (result.success) {
          commit(result.cart);
          return;
        }

        fail(result);
        if (!result.cartGone) {
          setLineErrors((prev) => ({ ...prev, [lineId]: result.message }));
        }
      });
    },
    [commit, enqueue, fail],
  );

  const addItem = useCallback(
    (variantId: string, quantity: number) =>
      enqueue(async () => {
        const result = await safely(() => addItemAction(variantId, quantity));
        if (result.success) {
          commit(result.cart);
          setDrawerOpen(true);
        }
        return result;
      }),
    [commit, enqueue],
  );

  const applyDiscount = useCallback(
    (code: string) =>
      enqueue(async () => {
        const result = await safely(() => applyDiscountCode(code));
        if (result.success) {
          commit(result.cart);
        } else if (result.cartGone) {
          fail(result);
        }
        return result;
      }),
    [commit, enqueue, fail],
  );

  const removeDiscount = useCallback(
    (code: string) =>
      enqueue(async () => {
        const currentCodes =
          confirmedRef.current?.discountCodes
            .filter((item) => item.applicable)
            .map((item) => item.code) ?? [];
        const result = await safely(() =>
          removeDiscountCode(code, currentCodes),
        );
        if (result.success) {
          commit(result.cart);
        } else if (result.cartGone) {
          fail(result);
        }
        return result;
      }),
    [commit, enqueue, fail],
  );

  const flush = useCallback(async () => {
    const failuresBefore = failuresRef.current;
    sendDirty();
    await queueRef.current;
    return failuresRef.current === failuresBefore;
  }, [sendDirty]);

  const seed = useCallback(
    (cart: Cart | null) => {
      // A pending write will return a fresher cart than any server render.
      if (inFlightRef.current > 0 || dirtyRef.current.size > 0) {
        return;
      }

      const current = confirmedRef.current;
      if (cart === null) {
        if (statusRef.current !== "ready") {
          commit(null);
        }
        return;
      }

      if (statusRef.current !== "ready" || !current || isNewer(cart, current)) {
        commit(cart);
      }
    },
    [commit],
  );

  const ensureLoaded = useCallback(() => {
    if (statusRef.current !== "idle") {
      return;
    }
    statusRef.current = "loading";
    setStatus("loading");

    void (async () => {
      const cart = await getCurrentCart().catch(() => null);
      // A mutation or seed may have landed first; keep it.
      if (statusRef.current === "loading") {
        commit(cart);
      }
    })();
  }, [commit]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const cart = useMemo(
    () =>
      confirmed ? applyPendingEdits(confirmed, overrides, removedIds) : null,
    [confirmed, overrides, removedIds],
  );

  const pendingLineIds = useMemo(
    () => new Set([...Object.keys(overrides), ...removedIds]),
    [overrides, removedIds],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      status,
      pending: inFlight > 0 || pendingLineIds.size > 0,
      pendingLineIds,
      lineErrors,
      seed,
      ensureLoaded,
      setQuantity,
      removeLine,
      addItem,
      applyDiscount,
      removeDiscount,
      flush,
      drawerOpen,
      openDrawer,
      closeDrawer,
    }),
    [
      cart,
      status,
      inFlight,
      pendingLineIds,
      lineErrors,
      seed,
      ensureLoaded,
      setQuantity,
      removeLine,
      addItem,
      applyDiscount,
      removeDiscount,
      flush,
      drawerOpen,
      openDrawer,
      closeDrawer,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}

/**
 * Seeds the provider from a server-rendered cart before paint and returns the
 * cart to render: the server snapshot until the provider is ready, then the
 * live optimistic cart.
 */
export function useSeededCart(initialCart: Cart | null) {
  const ctx = useCart();
  const { seed } = ctx;

  useLayoutEffect(() => {
    seed(initialCart);
  }, [seed, initialCart]);

  return ctx.status === "ready" ? ctx.cart : initialCart;
}
