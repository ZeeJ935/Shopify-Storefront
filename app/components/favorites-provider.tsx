"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  clearLocalFavourites,
  readLocalFavourites,
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
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

const LOGIN_HREF = "/account/login";

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { pushToast } = useStorefrontToast();
  const [hydrated, setHydrated] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const local = readLocalFavourites();

      try {
        const remote = await getFavouritesState();
        if (cancelled) return;

        if (remote.authenticated) {
          setAuthenticated(true);
          if (local.length > 0) {
            const synced = await syncFavouritesOnLogin(local);
            if (cancelled) return;
            setIds(synced.ids);
            clearLocalFavourites();
          } else {
            setIds(remote.ids);
            clearLocalFavourites();
          }
        } else {
          setAuthenticated(false);
          setIds([]);
          clearLocalFavourites();
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
          setIds([]);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    (productId: string) => {
      if (!productId) return false;

      if (!authenticated) {
        router.push(LOGIN_HREF);
        return false;
      }

      setIds((prev) => {
        const exists = prev.includes(productId);
        const next = exists
          ? prev.filter((id) => id !== productId)
          : [...prev, productId];

        void (async () => {
          const result = await saveFavourites(next);
          if (!result.ok) {
            setIds(prev);
            pushToast(result.message || "Could not update favourites.", "error");
          }
        })();

        return next;
      });

      return true;
    },
    [authenticated, pushToast, router],
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
    }),
    [hydrated, authenticated, idSet, ids.length, toggle],
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
