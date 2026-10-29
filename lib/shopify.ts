const storeDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
const storefrontToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();

/** Cache tag on all catalog data (products, collections, search, menus). */
export const CATALOG_TAG = "catalog";

export type ShopifyFetchOptions = {
  /** Seconds. Omit or undefined keeps cache: "no-store" (cart / session). */
  revalidate?: number;
};

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /aborted|timeout/i.test(error.message)
  );
}

export async function shopifyFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: ShopifyFetchOptions = {},
): Promise<T> {
  if (!storeDomain || !storefrontToken) {
    throw new Error("Missing Shopify environment variables.");
  }

  const useRevalidate =
    typeof options.revalidate === "number" && options.revalidate >= 0;

  // AbortSignal only on uncached cart/session fetches — attaching it to
  // revalidated catalog fetches can opt them out of the static cache shell.
  let response: Response;
  try {
    response = await fetch(
      `https://${storeDomain}/api/2026-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": storefrontToken,
        },
        body: JSON.stringify({ query, variables }),
        ...(useRevalidate
          ? // Every cached Storefront query is catalog data; the tag lets the
            // Shopify webhook route refresh it all at once.
            { next: { revalidate: options.revalidate, tags: [CATALOG_TAG] } }
          : {
              cache: "no-store" as const,
              signal: AbortSignal.timeout(20_000),
            }),
      },
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Shopify request timed out.");
    }
    throw new Error("Shopify network request failed.");
  }

  if (!response.ok) {
    throw new Error(`Shopify API request failed: ${response.status}`);
  }

  let result: { data?: T; errors?: unknown };
  try {
    result = (await response.json()) as { data?: T; errors?: unknown };
  } catch {
    throw new Error("Shopify returned an invalid response.");
  }

  if (result.errors) {
    throw new Error("Shopify GraphQL request failed.");
  }

  if (result.data === undefined || result.data === null) {
    throw new Error("Shopify returned no data.");
  }

  return result.data;
}

/**
 * Default revalidate window for catalog / homepage queries. A backup only:
 * Shopify webhooks (app/api/webhooks/shopify) refresh the catalog on change.
 */
export const CATALOG_REVALIDATE = 120;
