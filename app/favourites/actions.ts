"use server";

import { unstable_rethrow } from "next/navigation";
import {
  getCustomerFavouriteIds,
  setCustomerFavouriteIds,
} from "@/lib/customer-account/api";
import { hasCustomerSession } from "@/lib/customer-account/session";
import { mergeFavouriteIds, parseFavouriteIds } from "@/lib/favourites";
import { getProductsByIds, type ProductListItem } from "@/lib/products";

/** Most favourites a customer can hold; keeps the metafield and lookups bounded. */
const MAX_FAVOURITES = 200;

export type FavouritesStateResult = {
  authenticated: boolean;
  ids: string[];
  /**
   * False when a signed-in customer's list couldn't be read. `ids` is then
   * empty but NOT authoritative: saving it would wipe their real favourites.
   */
  loaded: boolean;
};

export async function getFavouritesState(): Promise<FavouritesStateResult> {
  const authenticated = await hasCustomerSession();
  if (!authenticated) {
    return { authenticated: false, ids: [], loaded: true };
  }

  try {
    const ids = await getCustomerFavouriteIds();
    return { authenticated: true, ids, loaded: true };
  } catch {
    // Deliberately no rethrow: this runs in the background on every page, so
    // an expiring session must not redirect the shopper away mid-browse.
    return { authenticated: true, ids: [], loaded: false };
  }
}

export async function syncFavouritesOnLogin(
  localIds: string[],
): Promise<FavouritesStateResult> {
  const authenticated = await hasCustomerSession();
  if (!authenticated) {
    return {
      authenticated: false,
      ids: parseFavouriteIds(localIds).slice(0, MAX_FAVOURITES),
      loaded: true,
    };
  }

  try {
    const remote = await getCustomerFavouriteIds();
    const merged = mergeFavouriteIds(remote, parseFavouriteIds(localIds)).slice(
      0,
      MAX_FAVOURITES,
    );
    const result = await setCustomerFavouriteIds(merged);
    if (!result.ok) {
      throw new Error(friendlyFavouritesError(result.message));
    }
    return { authenticated: true, ids: merged, loaded: true };
  } catch (error) {
    unstable_rethrow(error);
    throw error instanceof Error
      ? new Error(friendlyFavouritesError(error.message))
      : new Error(friendlyFavouritesError());
  }
}

export async function saveFavourites(
  ids: string[],
): Promise<{ ok: boolean; message?: string }> {
  const authenticated = await hasCustomerSession();
  if (!authenticated) {
    return { ok: false, message: "Sign in to sync favourites." };
  }

  const cleaned = parseFavouriteIds(ids);
  if (cleaned.length > MAX_FAVOURITES) {
    return {
      ok: false,
      message: `You can save up to ${MAX_FAVOURITES} favourites.`,
    };
  }

  try {
    const result = await setCustomerFavouriteIds(cleaned);
    return result.ok
      ? { ok: true }
      : { ok: false, message: friendlyFavouritesError(result.message) };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message: friendlyFavouritesError(
        error instanceof Error ? error.message : undefined,
      ),
    };
  }
}

function friendlyFavouritesError(message?: string) {
  const raw = message || "Could not save favourites.";
  if (/namespace and key on Metafields|not allowed/i.test(raw)) {
    return "Favourites aren’t set up in Shopify yet. In Admin, create a customer metafield custom.favourites (JSON) with Customer account access: Read and write.";
  }
  return raw;
}

export async function loadFavouriteProducts(
  ids: string[],
): Promise<ProductListItem[]> {
  const cleaned = parseFavouriteIds(ids).slice(0, MAX_FAVOURITES);
  if (cleaned.length === 0) return [];
  return getProductsByIds(cleaned);
}
