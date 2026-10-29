import Link from "next/link";
import { Suspense } from "react";
import ProductCard from "@/app/components/product-card";
import SiteContainer from "@/app/components/site-container";
import { searchProducts } from "@/lib/search";

// Same limit as /api/predictive-search; real searches are short.
const MAX_QUERY_LENGTH = 100;

function cleanQuery(q: string | undefined) {
  return (q ?? "").trim().slice(0, MAX_QUERY_LENGTH);
}

type SearchPageProps = {
  searchParams: Promise<{ q?: string; after?: string }>;
};

export async function generateMetadata({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = cleanQuery(q);
  return {
    title: query ? `Search: ${query}` : "Search",
    description: query
      ? `Search results for ${query}`
      : "Search the ZJ Store catalog.",
    // Endless query variations would be thin, duplicate pages; links still count.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, after } = await searchParams;
  const query = cleanQuery(q);

  let products: Awaited<ReturnType<typeof searchProducts>>["products"] = [];
  let pageInfo = { hasNextPage: false, endCursor: null as string | null };

  if (query) {
    try {
      const result = await searchProducts(query, {
        first: 24,
        after: after || undefined,
      });
      products = result.products;
      pageInfo = result.pageInfo;
    } catch {
      products = [];
    }
  }

  const loadMoreHref =
    pageInfo.hasNextPage && pageInfo.endCursor
      ? `/search?q=${encodeURIComponent(query)}&after=${encodeURIComponent(pageInfo.endCursor)}`
      : null;

  return (
    <main>
      <SiteContainer className="py-12">
      <h1 className="display-section text-ink">Search</h1>
      <form action="/search" className="mt-6 max-w-xl">
        <label htmlFor="q" className="sr-only">
          Search products
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            maxLength={MAX_QUERY_LENGTH}
            defaultValue={query}
            placeholder="Search products"
            className="field"
          />
          <button type="submit" className="btn btn-primary shrink-0">
            Search
          </button>
        </div>
      </form>

      {!query ? (
        <p className="mt-8 text-steel">
          Enter a query, or{" "}
          <Link href="/collections/all" className="underline">
            browse the catalog
          </Link>
          .
        </p>
      ) : (
        <Suspense fallback={<p className="mt-8 text-steel">Searching…</p>}>
          <p className="mt-8 text-sm text-steel">
            {products.length} result{products.length === 1 ? "" : "s"} for “
            {query}”
          </p>
          {products.length === 0 ? (
            <p className="mt-6 text-steel">No products found.</p>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
              {products.map((product) => (
                <div key={product.id} className="min-w-0">
                  <ProductCard product={product} />
                </div>
              ))}
            </div>
          )}
          {loadMoreHref && (
            <div className="mt-10 flex justify-center">
              <Link href={loadMoreHref} className="btn btn-secondary">
                Load more
              </Link>
            </div>
          )}
        </Suspense>
      )}
      </SiteContainer>
    </main>
  );
}
