"use server";

import { unstable_rethrow } from "next/navigation";
import {
  getBackendFavourites,
  isBackendConfigured,
  putBackendFavourites,
} from "@/lib/backend";
import { getCustomerId, hasCustomerSession } from "@/lib/customer-account/session";
import { parseFavouriteIds } from "@/lib/favourites";
import {
  describeFavouritesError,
  loadFavourites,
  MAX_FAVOURITES,
  mergeForLogin,
  type LoadedFavourites,
} from "@/lib/favourites-store";
import { getProductsByIds, type ProductListItem } from "@/lib/products";
import { reportError } from "@/lib/report-error";

export type FavouritesStateResult = {
  authenticated: boolean;
  ids: string[];
  /**
   * False when a signed-in customer's list couldn't be read. `ids` is then
   * empty but NOT authoritative: saving it would wipe their real favourites.
   */
  loaded: boolean;
};

// Favourites live in Postgres, read and written through the backend. If the
// backend isn't configured or can't be reached, favourites show as not loaded
// and nothing is written, so a failed read can never overwrite saved favourites.

/** The signed-in customer's saved list. */
async function readSaved(): Promise<LoadedFavourites> {
  if (!isBackendConfigured()) {
    reportError(new Error("BACKEND_URL / BACKEND_SERVICE_TOKEN not set"), { area: "favourites", step: "load" });
    return { ids: [], loaded: false };
  }
  const customerId = await getCustomerId();
  if (!customerId) {
    reportError(new Error("signed in but the session has no customer ID"), { area: "favourites", step: "load" });
    return { ids: [], loaded: false };
  }
  return loadFavourites({
    get: () => getBackendFavourites(customerId),
    // Never logs the customer ID: backend errors carry only status and path.
    onError: (error) => reportError(new Error(describeFavouritesError(error)), { area: "favourites", step: "load" }),
  });
}

/** Replaces the saved list. Returns an error message for the toast, or null. */
async function writeSaved(ids: string[]): Promise<string | null> {
  if (!isBackendConfigured()) return friendlyFavouritesError("unavailable");
  const customerId = await getCustomerId();
  if (!customerId) return "Sign in to sync favourites.";
  await putBackendFavourites(customerId, ids);
  return null;
}

export async function getFavouritesState(): Promise<FavouritesStateResult> {
  const authenticated = await hasCustomerSession();
  if (!authenticated) {
    return { authenticated: false, ids: [], loaded: true };
  }

  // Deliberately no rethrow: this runs in the background on every page, so
  // an expiring session must not redirect the shopper away mid-browse.
  const saved = await readSaved().catch((error: unknown) => {
    reportError(new Error(describeFavouritesError(error)), { area: "favourites", step: "load" });
    return { ids: [] as string[], loaded: false };
  });
  return { authenticated: true, ...saved };
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
    const saved = await readSaved();
    if (!saved.loaded) {
      // Never merge into (and then save over) a list we couldn't read.
      throw new Error(friendlyFavouritesError("unavailable"));
    }
    const merged = mergeForLogin(saved.ids, localIds);
    const message = await writeSaved(merged);
    if (message) throw new Error(message);
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
    const message = await writeSaved(cleaned);
    return message ? { ok: false, message } : { ok: true };
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

const UNAVAILABLE = "Favourites are unavailable right now. Please try again.";
const FRIENDLY = new Set([UNAVAILABLE, "Sign in to sync favourites."]);

function friendlyFavouritesError(message?: string) {
  const raw = message || "Could not save favourites.";
  if (FRIENDLY.has(raw)) return raw;
  if (raw === "unavailable" || /Backend request failed|BACKEND_|fetch failed|aborted|timeout/i.test(raw)) {
    reportError(new Error(raw), { area: "favourites", step: "backend" });
    return UNAVAILABLE;
  }
  // Anything else is API detail: keep it in the server log, not the toast.
  reportError(new Error(raw), { area: "favourites", step: "save" });
  return "Could not save favourites. Please try again.";
}

export async function loadFavouriteProducts(
  ids: string[],
): Promise<ProductListItem[]> {
  const cleaned = parseFavouriteIds(ids).slice(0, MAX_FAVOURITES);
  if (cleaned.length === 0) return [];
  return getProductsByIds(cleaned);
}
