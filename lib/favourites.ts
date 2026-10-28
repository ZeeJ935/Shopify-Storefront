export const FAVOURITES_STORAGE_KEY = "zj_favourites";
export const FAVOURITES_INTENT_KEY = "zj_favourites_intent";
export const FAVOURITES_METAFIELD_NAMESPACE = "custom";
export const FAVOURITES_METAFIELD_KEY = "favourites";

export type FavouritesIntent = {
  returnTo: string;
  addProductId?: string;
};

export function parseFavouriteIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw.filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
  }
  if (typeof raw === "string") {
    try {
      return parseFavouriteIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

export function safeReturnTo(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/account";
  }
  if (
    path.startsWith("/account/authorize") ||
    path.startsWith("/account/callback") ||
    path.startsWith("/account/logout") ||
    path.startsWith("/account/login")
  ) {
    return "/account";
  }
  return path;
}

export function readFavouritesIntent(): FavouritesIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FAVOURITES_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FavouritesIntent;
    if (!parsed?.returnTo) return null;
    return {
      returnTo: safeReturnTo(parsed.returnTo),
      addProductId: parsed.addProductId || undefined,
    };
  } catch {
    return null;
  }
}

export function writeFavouritesIntent(intent: FavouritesIntent) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    FAVOURITES_INTENT_KEY,
    JSON.stringify({
      returnTo: safeReturnTo(intent.returnTo),
      addProductId: intent.addProductId || undefined,
    }),
  );
}

export function clearFavouritesIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(FAVOURITES_INTENT_KEY);
}

export function readLocalFavourites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVOURITES_STORAGE_KEY);
    if (!raw) return [];
    return parseFavouriteIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalFavourites(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    FAVOURITES_STORAGE_KEY,
    JSON.stringify([...new Set(ids)]),
  );
}

export function clearLocalFavourites() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(FAVOURITES_STORAGE_KEY);
}

export function mergeFavouriteIds(a: string[], b: string[]) {
  return [...new Set([...a, ...b])];
}

export function loginUrlForFavourites(intent: FavouritesIntent) {
  const params = new URLSearchParams();
  params.set("returnTo", safeReturnTo(intent.returnTo));
  if (intent.addProductId) {
    params.set("add", intent.addProductId);
  }
  return `/account/login?${params.toString()}`;
}
