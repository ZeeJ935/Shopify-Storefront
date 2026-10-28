export const FAVOURITES_STORAGE_KEY = "zj_favourites";
export const FAVOURITES_METAFIELD_NAMESPACE = "custom";
export const FAVOURITES_METAFIELD_KEY = "favourites";

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
