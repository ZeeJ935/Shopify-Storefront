"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  getFavouritesState,
  saveFavourites,
  syncFavouritesOnLogin,
} from "@/app/favourites/actions";
import {
  clearFavouritesIntent,
  clearLocalFavourites,
  loginUrlForFavourites,
  readFavouritesIntent,
  readLocalFavourites,
  writeFavouritesIntent,
} from "@/lib/favourites";
import { useStorefrontToast } from "./storefront-toast";

type FavoritesContextValue = {
  hydrated: boolean;
  authenticated: boolean;
  ids: ReadonlySet<string>;
  count: number;
  isFavourite: (productId: string) => boolean;
  /** Returns false if redirected to login (guest). */
  toggle: (productId: string) => boolean;
  /** Navbar / guest entry: login then land on favourites. */
  goToFavourites: () => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

const LOAD_FAILED_MESSAGE =
  "We couldn't load your favourites. Please try again.";

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function toggled(ids: string[], productId: string) {
  return ids.includes(productId)
    ? ids.filter((id) => id !== productId)
    : [...ids, productId];
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { pushToast } = useStorefrontToast();
  const [hydrated, setHydrated] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [authenticated, setAuthenticated] = useState(false);

  // Latest list shown to the shopper, and the last list Shopify confirmed.
  const idsRef = useRef<string[]>([]);
  const confirmedRef = useRef<string[]>([]);
  // False while a signed-in list failed to load: saving then would overwrite it.
  const loadedRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const showIds = useCallback((next: string[]) => {
    idsRef.current = next;
    setIds(next);
  }, []);

  const markConfirmed = useCallback(
    (next: string[]) => {
      confirmedRef.current = next;
      loadedRef.current = true;
      showIds(next);
    },
    [showIds],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const local = readLocalFavourites();
      const intent = readFavouritesIntent();

      try {
        const remote = await getFavouritesState();
        if (cancelled) return;

        if (!remote.authenticated) {
          setAuthenticated(false);
          showIds([]);
          clearLocalFavourites();
          return;
        }

        setAuthenticated(true);

        if (!remote.loaded) {
          // Keep local favourites and the login intent so a later load can merge them.
          loadedRef.current = false;
          showIds([]);
          return;
        }

        let nextIds = remote.ids;
        try {
          if (local.length > 0) {
            const synced = await syncFavouritesOnLogin(local);
            if (cancelled) return;
            nextIds = synced.ids;
          }
          clearLocalFavourites();
          markConfirmed(nextIds);

          if (intent?.addProductId && !nextIds.includes(intent.addProductId)) {
            const withPending = [...nextIds, intent.addProductId];
            showIds(withPending);
            clearFavouritesIntent();
            const result = await saveFavourites(withPending);
            if (cancelled) return;
            if (result.ok) {
              confirmedRef.current = withPending;
            } else {
              showIds(nextIds);
              pushToast(result.message || "Could not update favourites.", "error");
            }
          } else {
            clearFavouritesIntent();
          }
        } catch (error) {
          if (cancelled) return;
          markConfirmed(nextIds);
          clearFavouritesIntent();
          clearLocalFavourites();
          pushToast(
            error instanceof Error ? error.message : "Could not sync favourites.",
            "error",
          );
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
          showIds([]);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [markConfirmed, pushToast, showIds]);

  /**
   * Saves run one at a time and always send the latest list, so rapid toggles
   * collapse into one request and can't land out of order. A failure rolls
   * back to the last list Shopify confirmed, not to a stale snapshot.
   */
  const persist = useCallback(() => {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const snapshot = idsRef.current;
      if (sameIds(snapshot, confirmedRef.current)) return;

      const result = await saveFavourites(snapshot).catch(() => ({
        ok: false,
        message: undefined,
      }));

      if (result.ok) {
        confirmedRef.current = snapshot;
        return;
      }
      showIds(confirmedRef.current);
      pushToast(result.message || "Could not update favourites.", "error");
    });
  }, [pushToast, showIds]);

  /** Retries a failed load; resolves true once the real list is in hand. */
  const reload = useCallback(async () => {
    const remote = await getFavouritesState().catch(() => null);
    if (!remote?.authenticated || !remote.loaded) {
      return false;
    }
    markConfirmed(remote.ids);
    return true;
  }, [markConfirmed]);

  const goToFavourites = useCallback(() => {
    // Same as toggle: before the first load everyone looks signed out.
    if (!hydrated) return;

    if (authenticated) {
      router.push("/account/favourites");
      return;
    }
    const intent = {
      returnTo: "/account/favourites",
    };
    writeFavouritesIntent(intent);
    router.push(loginUrlForFavourites(intent));
  }, [authenticated, hydrated, router]);

  const toggle = useCallback(
    (productId: string) => {
      if (!productId) return false;

      // Until the first load finishes, everyone looks signed out; ignore the
      // click rather than bouncing a signed-in shopper to login.
      if (!hydrated) return true;

      if (!authenticated) {
        const intent = {
          returnTo: currentPath(),
          addProductId: productId,
        };
        writeFavouritesIntent(intent);
        router.push(loginUrlForFavourites(intent));
        return false;
      }

      if (!loadedRef.current) {
        // Never save on top of a list we couldn't read; load it first.
        void reload().then((ok) => {
          if (!ok) {
            pushToast(LOAD_FAILED_MESSAGE, "error");
            return;
          }
          showIds(toggled(idsRef.current, productId));
          persist();
        });
        return true;
      }

      showIds(toggled(idsRef.current, productId));
      persist();
      return true;
    },
    [authenticated, hydrated, persist, pushToast, reload, router, showIds],
  );

  const idSet = useMemo(() => new Set(ids), [ids]);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      hydrated,
      authenticated,
      ids: idSet,
      count: authenticated ? ids.length : 0,
      isFavourite: (productId: string) =>
        authenticated && idSet.has(productId),
      toggle,
      goToFavourites,
    }),
    [hydrated, authenticated, idSet, ids.length, toggle, goToFavourites],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return ctx;
}
