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
      throw new Error(result.message || "Could not sync favourites.");
    }
    return { authenticated: true, ids: merged };
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Could not sync favourites.");
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
      : { ok: false, message: result.message || "Could not save favourites." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not save favourites.",
    };
  }
}

export async function loadFavouriteProducts(
  ids: string[],
): Promise<ProductListItem[]> {
  const cleaned = parseFavouriteIds(ids);
  if (cleaned.length === 0) return [];
  return getProductsByIds(cleaned);
}
