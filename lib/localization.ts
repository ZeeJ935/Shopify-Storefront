import { cacheLife } from "next/cache";
import { shopifyFetch } from "./shopify";

// Server-only: client components may import the type, never the function
// (cacheLife only works in server code).

export type ShippingCountry = {
  isoCode: string;
  name: string;
};

export type ShippingCountries = {
  /** Countries the store sells to (its Shopify Markets), sorted by name. */
  countries: ShippingCountry[];
  /** The store's own country (primary market): the default for new addresses. */
  defaultCountry: string | null;
};

export async function getShippingCountries(): Promise<ShippingCountries> {
  "use cache";
  cacheLife("hours");

  const data = await shopifyFetch<{
    localization: {
      availableCountries: ShippingCountry[];
      country: { isoCode: string } | null;
    };
  }>(
    `query ShippingCountries {
      localization {
        availableCountries {
          isoCode
          name
        }
        country {
          isoCode
        }
      }
    }`,
  );

  return {
    countries: [...data.localization.availableCountries].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    defaultCountry: data.localization.country?.isoCode ?? null,
  };
}
