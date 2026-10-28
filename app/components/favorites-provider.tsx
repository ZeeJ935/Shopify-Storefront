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

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

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
      const intent = readFavouritesIntent();

      try {
        const remote = await getFavouritesState();
        if (cancelled) return;

        if (remote.authenticated) {
          setAuthenticated(true);

          let nextIds = remote.ids;
          try {
            if (local.length > 0) {
              const synced = await syncFavouritesOnLogin(local);
              if (cancelled) return;
              nextIds = synced.ids;
              clearLocalFavourites();
            } else {
              clearLocalFavourites();
            }

            if (
              intent?.addProductId &&
              !nextIds.includes(intent.addProductId)
            ) {
              const withPending = [...nextIds, intent.addProductId];
              setIds(withPending);
              clearFavouritesIntent();
              const result = await saveFavourites(withPending);
              if (cancelled) return;
              if (!result.ok) {
                setIds(nextIds);
                pushToast(
                  result.message || "Could not update favourites.",
                  "error",
                );
              }
            } else {
              setIds(nextIds);
              clearFavouritesIntent();
            }
          } catch (error) {
            if (cancelled) return;
            setIds(nextIds);
            clearFavouritesIntent();
            clearLocalFavourites();
            pushToast(
              error instanceof Error
                ? error.message
                : "Could not sync favourites.",
              "error",
            );
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
  }, [pushToast]);

  const goToFavourites = useCallback(() => {
    if (authenticated) {
      router.push("/account/favourites");
      return;
    }
    const intent = {
      returnTo: "/account/favourites",
    };
    writeFavouritesIntent(intent);
    router.push(loginUrlForFavourites(intent));
  }, [authenticated, router]);

  const toggle = useCallback(
    (productId: string) => {
      if (!productId) return false;

      if (!authenticated) {
        const intent = {
          returnTo: currentPath(),
          addProductId: productId,
        };
        writeFavouritesIntent(intent);
        router.push(loginUrlForFavourites(intent));
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
