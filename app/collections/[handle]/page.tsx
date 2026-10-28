import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import SiteContainer from "@/app/components/site-container";
import {
  parseCatalogParams,
  queryCatalog,
} from "@/lib/catalog-query";
import { getCatalogSnapshot } from "@/lib/catalog-snapshot";
import { shopifyFetch, CATALOG_REVALIDATE } from "@/lib/shopify";
import CollectionBrowse from "../collection-browse";


type PageProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toURLSearchParams(
  record: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, value);
  }
  return params;
}

async function getCollectionMeta(handle: string) {
  const data = await shopifyFetch<{
    collection: {
      title: string;
      description: string;
      image: { url: string; altText: string | null } | null;
    } | null;
  }>(
    `
    query CollectionMeta($handle: String!) {
      collection(handle: $handle) {
        title
        description
        image { url altText }
      }
    }
  `,
    { handle },
    { revalidate: CATALOG_REVALIDATE },
  );
  return data.collection;
}

export async function generateMetadata({ params }: PageProps) {
  const { handle } = await params;
  try {
    const meta = await getCollectionMeta(handle);
    if (!meta) return { title: "Collection" };
    return {
      title: meta.title,
      description: meta.description || undefined,
    };
  } catch {
    return { title: "Collection" };
  }
}

export default async function CollectionPage({
  params,
  searchParams,
}: PageProps) {
  const { handle } = await params;
  const sp = toURLSearchParams(await searchParams);
  const { filters, sort } = parseCatalogParams(sp);

  let meta;
  try {
    meta = await getCollectionMeta(handle);
  } catch {
    meta = null;
  }
  if (!meta) notFound();

  // Empty collections (e.g. nike) still render; membership may be empty.
  await getCatalogSnapshot();

  let result: Awaited<ReturnType<typeof queryCatalog>>;
  try {
    result = await queryCatalog({
      scope: handle,
      filters,
      sort,
      page: 1,
    });
  } catch {
    result = {
      products: [],
      total: 0,
      page: 1,
      pageCount: 1,
      hasNextPage: false,
      facets: [],
      priceBounds: { min: 0, max: 0 },
      sort,
      sortOptions: [],
      hideGenderFacet: false,
    };
  }

  return (
    <main className="py-8 lg:py-12">
      <SiteContainer>
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-steel">
          <ol className="flex flex-wrap gap-2">
            <li>
              <Link href="/" className="hover:underline">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/collections" className="hover:underline">
                Collections
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-ink">{meta.title}</li>
          </ol>
        </nav>
      </SiteContainer>

      {meta.image && (
        <div className="relative mb-8 aspect-[21/6] overflow-hidden bg-mist">
          <Image
            src={meta.image.url}
            alt={meta.image.altText ?? meta.title}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-ink/25" />
          <SiteContainer className="absolute inset-0 flex items-end py-6 sm:py-10">
            <h1 className="display-section text-snow">{meta.title}</h1>
          </SiteContainer>
        </div>
      )}

      <SiteContainer>
        {!meta.image && (
          <h1 className="display-section text-ink">{meta.title}</h1>
        )}

        {meta.description && (
          <p className="mt-3 max-w-2xl text-steel">{meta.description}</p>
        )}

        <div className="mt-8">
          <Suspense fallback={<p className="text-steel">Loading products…</p>}>
            <CollectionBrowse
              key={`${handle}?${sp.toString()}`}
              scope={handle}
              initialProducts={result.products}
              initialTotal={result.total}
              initialPage={1}
              initialHasNextPage={result.hasNextPage}
              facets={result.facets}
              priceBounds={result.priceBounds}
              sortOptions={result.sortOptions}
              initialSort={result.sort}
            />
          </Suspense>
        </div>
      </SiteContainer>
    </main>
  );
}
