// Decides where a signed-in customer's favourites come from. Pure: dependencies
// are passed in, so it is unit tested without a network (scripts/audit-unit.ts).
import { mergeFavouriteIds, parseFavouriteIds } from "./favourites";

export const MAX_FAVOURITES = 200;

/** Postgres once both backend variables are set; until then the Shopify metafield (the fallback). */
export function pickFavouritesStore(env: {
  BACKEND_URL?: string;
  BACKEND_SERVICE_TOKEN?: string;
}): "postgres" | "metafield" {
  return env.BACKEND_URL?.trim() && env.BACKEND_SERVICE_TOKEN?.trim() ? "postgres" : "metafield";
}

export type LoadedFavourites = { ids: string[]; loaded: boolean };

export type FavouritesBackend = {
  get(): Promise<{ ids: string[]; imported: boolean }>;
  importOnce(ids: string[]): Promise<{ ids: string[]; imported: boolean }>;
};

/**
 * Postgres is the store. The first time a customer is seen (not imported yet),
 * their Shopify metafield list is read once and imported. If anything fails, the
 * result is `loaded: false` and nothing has been written, so a failed read can
 * never overwrite saved favourites.
 */
export async function loadFavourites(deps: {
  backend: FavouritesBackend;
  readMetafield: () => Promise<string[]>;
}): Promise<LoadedFavourites> {
  try {
    const current = await deps.backend.get();
    if (current.imported) return { ids: current.ids, loaded: true };

    // Throws if Shopify can't be read: we stop here rather than import a wrong (empty) list.
    const fromMetafield = parseFavouriteIds(await deps.readMetafield()).slice(0, MAX_FAVOURITES);
    const imported = await deps.backend.importOnce(fromMetafield);
    return { ids: imported.ids, loaded: true };
  } catch {
    return { ids: [], loaded: false };
  }
}

/** Login merge: saved favourites first (in their order), then guest ones not already saved; capped. */
export function mergeForLogin(remote: string[], local: unknown, max = MAX_FAVOURITES): string[] {
  return mergeFavouriteIds(parseFavouriteIds(remote), parseFavouriteIds(local)).slice(0, max);
}
