import type { MetadataRoute } from "next";
import { getCatalogSnapshot } from "@/lib/catalog-snapshot";
import { getCollectionsIndex } from "@/lib/collections";
import { getSiteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  if (!siteUrl) {
    return [];
  }

  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    {
      url: `${siteUrl}/collections`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/collections/all`,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  try {
    const [collections, snapshot] = await Promise.all([
      getCollectionsIndex(50),
      getCatalogSnapshot(),
    ]);

    for (const collection of collections) {
      entries.push({
        url: `${siteUrl}/collections/${collection.handle}`,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }

    for (const product of snapshot.products) {
      entries.push({
        url: `${siteUrl}/products/${product.handle}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // Return static routes only if catalog fetch fails.
  }

  return entries;
}
