import { cacheLife } from "next/cache";
import { shopifyFetch } from "./shopify";

// Server-only: client components may import the type, never the function
// (cacheLife only works in server code).

export type ShippingCountry = {
  isoCode: string;
  name: string;
};

/** Countries the store sells to (its Shopify Markets), sorted by name. */
export async function getShippingCountries(): Promise<ShippingCountry[]> {
  "use cache";
  cacheLife("hours");

  const data = await shopifyFetch<{
    localization: { availableCountries: ShippingCountry[] };
  }>(
    `query ShippingCountries {
      localization {
        availableCountries {
          isoCode
          name
        }
      }
    }`,
  );

  return [...data.localization.availableCountries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
