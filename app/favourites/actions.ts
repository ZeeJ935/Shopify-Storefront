"use server";

import { unstable_rethrow } from "next/navigation";
import {
  getBackendFavourites,
  importBackendFavourites,
  isBackendConfigured,
  putBackendFavourites,
} from "@/lib/backend";
import {
  getCustomerFavouriteIds,
  setCustomerFavouriteIds,
} from "@/lib/customer-account/api";
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

// Where favourites live: Postgres (via the backend) once BACKEND_URL and
// BACKEND_SERVICE_TOKEN are set, otherwise the Shopify metafield as before.
// If the backend is configured but down, favourites show as not loaded; we do
// NOT fall back to the metafield then, which would split data across two stores.
let loggedStore = false;
function postgresEnabled() {
  const postgres = isBackendConfigured();
  if (!loggedStore) {
    loggedStore = true;
    console.info(`[favourites] store: ${postgres ? "postgres" : "metafield"}`);
  }
  return postgres;
}

/** The signed-in customer's saved list. Never writes unless it is the one-time metafield import. */
async function readSaved(): Promise<LoadedFavourites> {
  if (!postgresEnabled()) {
    // TODO(remove after favourites import is verified): metafield fallback.
    // Errors propagate as before (an expired session redirects to refresh).
    return { ids: await getCustomerFavouriteIds(), loaded: true };
  }

  const customerId = await getCustomerId();
  if (!customerId) {
    reportError(new Error("signed in but the session has no customer ID"), { area: "favourites", step: "load" });
    return { ids: [], loaded: false };
  }
  return loadFavourites({
    backend: {
      get: () => getBackendFavourites(customerId),
      importOnce: (ids) => importBackendFavourites(customerId, ids),
    },
    // TODO(remove after favourites import is verified): one-time import source.
    readMetafield: getCustomerFavouriteIds,
    // Never logs the customer ID: backend errors carry only status and path.
    onError: (stage, error) =>
      reportError(new Error(describeFavouritesError(error)), { area: "favourites", step: `load-${stage}` }),
  });
}

/** Replaces the saved list. Returns an error message for the toast, or null. */
async function writeSaved(ids: string[]): Promise<string | null> {
  if (!postgresEnabled()) {
    // TODO(remove after favourites import is verified): metafield fallback.
    const result = await setCustomerFavouriteIds(ids);
    return result.ok ? null : friendlyFavouritesError(result.message);
  }
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
  if (/namespace and key on Metafields|not allowed/i.test(raw)) {
    return "Favourites aren’t set up in Shopify yet. In Admin, create a customer metafield custom.favourites (JSON) with Customer account access: Read and write.";
  }
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
