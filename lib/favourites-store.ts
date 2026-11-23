// Loading and merging a signed-in customer's favourites. Pure: dependencies are
// passed in, so it is unit tested without a network (scripts/audit-unit.ts).
import { mergeFavouriteIds, parseFavouriteIds } from "./favourites";

export const MAX_FAVOURITES = 200;

export type LoadedFavourites = { ids: string[]; loaded: boolean };

/**
 * Reads the saved list from the backend (Postgres). If that fails, the result
 * is `loaded: false`: the list is unknown, not empty, so nothing may be saved
 * on top of it.
 */
export async function loadFavourites(deps: {
  get: () => Promise<{ ids: string[] }>;
  /** Told why a load failed, so the server log explains a "not loaded". */
  onError?: (error: unknown) => void;
}): Promise<LoadedFavourites> {
  try {
    const { ids } = await deps.get();
    return { ids: parseFavouriteIds(ids), loaded: true };
  } catch (error) {
    deps.onError?.(error);
    return { ids: [], loaded: false };
  }
}

/** A short, log-safe reason: status and path for backend errors, otherwise the error's name and message. */
export function describeFavouritesError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; status?: unknown; path?: unknown };
    if (e.name === "BackendError" && typeof e.status === "number") {
      return `backend returned ${e.status} for ${String(e.path)}`;
    }
    const name = typeof e.name === "string" ? e.name : "Error";
    const message = typeof e.message === "string" ? e.message : "";
    return `${name}: ${message}`.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

/** Login merge: saved favourites first (in their order), then guest ones not already saved; capped. */
export function mergeForLogin(remote: string[], local: unknown, max = MAX_FAVOURITES): string[] {
  return mergeFavouriteIds(parseFavouriteIds(remote), parseFavouriteIds(local)).slice(0, max);
}
