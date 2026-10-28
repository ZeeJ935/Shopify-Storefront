"use server";

import {
  getCustomerFavouriteIds,
  setCustomerFavouriteIds,
} from "@/lib/customer-account/api";
import { hasCustomerSession } from "@/lib/customer-account/session";
import { mergeFavouriteIds, parseFavouriteIds } from "@/lib/favourites";
import { getProductsByIds, type ProductListItem } from "@/lib/products";

export type FavouritesStateResult = {
  authenticated: boolean;
  ids: string[];
};

export async function getFavouritesState(): Promise<FavouritesStateResult> {
  const authenticated = await hasCustomerSession();
  if (!authenticated) {
    return { authenticated: false, ids: [] };
  }

  try {
    const ids = await getCustomerFavouriteIds();
    return { authenticated: true, ids };
  } catch {
    return { authenticated: true, ids: [] };
  }
}

export async function syncFavouritesOnLogin(
  localIds: string[],
): Promise<FavouritesStateResult> {
  const authenticated = await hasCustomerSession();
  if (!authenticated) {
    return { authenticated: false, ids: parseFavouriteIds(localIds) };
  }

  try {
    const remote = await getCustomerFavouriteIds();
    const merged = mergeFavouriteIds(remote, parseFavouriteIds(localIds));
    const result = await setCustomerFavouriteIds(merged);
    if (!result.ok) {
      throw new Error(friendlyFavouritesError(result.message));
    }
    return { authenticated: true, ids: merged };
  } catch (error) {
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

  try {
    const result = await setCustomerFavouriteIds(parseFavouriteIds(ids));
    return result.ok
      ? { ok: true }
      : { ok: false, message: friendlyFavouritesError(result.message) };
  } catch (error) {
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
  const cleaned = parseFavouriteIds(ids);
  if (cleaned.length === 0) return [];
  return getProductsByIds(cleaned);
}
