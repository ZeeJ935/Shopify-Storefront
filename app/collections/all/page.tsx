import Link from "next/link";
import { Suspense } from "react";
import {
  parseCatalogParams,
  queryCatalog,
} from "@/lib/catalog-query";
import CollectionBrowse from "../collection-browse";

export const instant = false;

export const metadata = {
  title: "Catalog",
  description: "Browse the full ZJ Store catalog.",
};

type PageProps = {
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

export default async function AllProductsPage({ searchParams }: PageProps) {
  const sp = toURLSearchParams(await searchParams);
  const { filters, sort, page } = parseCatalogParams(sp);

  let result: Awaited<ReturnType<typeof queryCatalog>>;
  try {
    result = await queryCatalog({
      scope: null,
      filters,
      sort,
      page: 1, // SSR always seeds page 1; client loads more
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

  void page;

  const typeLabel = filters.type[0];
  const brandLabel = filters.brand[0];
  const title = typeLabel
    ? typeLabel
    : brandLabel
      ? brandLabel
      : "All products";

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
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
          <li className="text-ink">{title}</li>
        </ol>
      </nav>

      <h1 className="display-section text-ink">{title}</h1>
      <p className="mt-3 max-w-2xl text-steel">
        Browse the full catalog with filters and sorting.
      </p>

      <div className="mt-8">
        <Suspense fallback={<p className="text-steel">Loading products…</p>}>
          <CollectionBrowse
            key={sp.toString() || "all"}
            scope={null}
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
    </main>
  );
}
