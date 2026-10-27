import Image from "next/image";
import Link from "next/link";
import PopularTabs from "./components/popular-tabs";
import ProductCarousel from "./components/product-carousel";
import ProductCard from "./components/product-card";
import { getNavCatalog } from "@/lib/catalog";
import { getCollectionProductsPreview } from "@/lib/collections";
import { getProducts } from "@/lib/products";
import {
  brandBenefits,
  editorialGuides,
  heroSlides,
  siteBrand,
} from "@/lib/site-content";

export const instant = false;

export default async function Home() {
  const catalog = await getNavCatalog();

  const [
    trending,
    sale,
    men,
    women,
    newest,
    bestSelling,
  ] = await Promise.all([
    getCollectionProductsPreview("trending", 12),
    getCollectionProductsPreview("sale", 4),
    getCollectionProductsPreview("men", 8),
    getCollectionProductsPreview("women", 8),
    getProducts({ first: 12, sortKey: "CREATED_AT", reverse: true })
      .then((r) => r.products)
      .catch(() => []),
    getProducts({ first: 12, sortKey: "BEST_SELLING" })
      .then((r) => r.products)
      .catch(() => []),
  ]);

  const trendingProducts = trending ?? bestSelling ?? newest;
  const heroConfig = heroSlides[0];

  const menCta = catalog.collections.has("men");
  const womenCta = catalog.collections.has("women");

  const guides = editorialGuides.filter((g) =>
    catalog.collections.has(g.collectionHandle),
  );

  return (
    <main>
      {/* Hero */}
      <section className="relative isolate min-h-[72vh] overflow-hidden bg-ink text-snow">
        <Image
          src="/images/hero-gear-mile.jpg"
          alt="Running sneakers on wet asphalt at dawn"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_40%] opacity-60 sm:object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/20" />
        <div className="relative mx-auto flex min-h-[72vh] max-w-7xl flex-col justify-end px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-mist">
            {siteBrand.name}
          </p>
          <h1 className="display-hero max-w-4xl">
            {heroConfig?.headline ?? "Gear for every mile"}
          </h1>
          <p className="mt-4 max-w-xl text-base text-mist sm:text-lg">
            {heroConfig?.subcopy ?? siteBrand.tagline}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {menCta && (
              <Link
                href="/collections/men"
                className="btn border border-snow bg-snow text-ink hover:bg-mist"
              >
                Shop Men
              </Link>
            )}
            {womenCta && (
              <Link
                href="/collections/women"
                className="btn border border-snow bg-transparent text-snow hover:bg-snow/10"
              >
                Shop Women
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Trending */}
      {trendingProducts.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="display-section text-ink">Trending now</h2>
            <Link
              href={
                catalog.collections.has("trending")
                  ? "/collections/trending"
                  : "/collections/all"
              }
              className="hidden text-sm font-semibold uppercase tracking-wide underline-offset-2 hover:underline sm:inline"
            >
              View all
            </Link>
          </div>
          <ProductCarousel
            products={trendingProducts}
            label="Trending products"
          />
        </section>
      )}

      {/* Shop by category */}
      {catalog.productTypeTiles.length > 0 && (
        <section className="bg-white py-14 lg:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="display-section mb-8 text-ink">Shop by category</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {catalog.productTypeTiles.map((tile) => (
                <Link
                  key={tile.productType}
                  href={tile.href}
                  className="group relative aspect-[4/5] overflow-hidden bg-mist sm:aspect-[3/4]"
                >
                  {tile.sampleImage && (
                    <Image
                      src={tile.sampleImage.url}
                      alt={tile.sampleImage.altText ?? tile.productType}
                      fill
                      sizes="(max-width: 640px) 100vw, 33vw"
                      className="object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent p-4 pt-12">
                    <span className="flex items-center gap-2 font-display text-xl font-bold uppercase tracking-wide text-snow">
                      {tile.productType}
                      <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Shop by brand */}
      {catalog.brandTiles.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <h2 className="display-section mb-8 text-ink">Shop by brand</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {catalog.brandTiles.map((brand) => (
              <Link
                key={brand.label}
                href={brand.href}
                className="group relative min-h-56 overflow-hidden bg-mist sm:min-h-72"
              >
                {brand.sampleImage ? (
                  <Image
                    src={brand.sampleImage.url}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="object-cover transition duration-500 group-hover:scale-[1.03]"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent p-6 pt-16">
                  <span className="flex items-center gap-2 font-display text-3xl font-bold uppercase tracking-wide text-snow">
                    {brand.label}
                    <span aria-hidden="true">→</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Popular right now */}
      {((men && men.length > 0) || (women && women.length > 0)) && (
        <section className="bg-white py-14 lg:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="display-section mb-8 text-ink">Popular right now</h2>
            <PopularTabs men={men ?? []} women={women ?? []} />
          </div>
        </section>
      )}

      {/* New arrivals */}
      {newest.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="display-section text-ink">New arrivals</h2>
            <Link
              href="/collections/all?sort=latest"
              className="hidden text-sm font-semibold uppercase tracking-wide underline-offset-2 hover:underline sm:inline"
            >
              View all
            </Link>
          </div>
          <ProductCarousel products={newest} label="New arrivals" />
        </section>
      )}

      {/* Sale strip */}
      {sale && sale.length > 0 && (
        <section className="bg-ink py-14 text-snow lg:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="display-section">On sale</h2>
                <p className="mt-2 text-mist">
                  Reduced styles with real compare-at pricing.
                </p>
              </div>
              <Link
                href="/collections/sale"
                className="btn border border-snow bg-transparent text-snow hover:bg-snow/10"
              >
                Shop sale
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6 [&_h3]:text-snow [&_p]:text-mist [&_.text-ink]:text-snow [&_.text-steel]:text-mist [&_button]:text-snow [&_a]:text-snow">
              {sale.slice(0, 4).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Brand / value strip */}
      <section className="border-y border-mist bg-white py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {brandBenefits.map((b) => (
            <div key={b.id}>
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                {b.title}
              </h3>
              <p className="mt-2 text-sm text-steel">
                {b.description}
                {b.demo ? (
                  <span className="sr-only"> Demo placeholder.</span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Editorial guides */}
      {guides.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <h2 className="display-section mb-8 text-ink">Shop the look</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {guides.map((guide) => {
              const col = catalog.collections.get(guide.collectionHandle);
              const img =
                col?.image ??
                col?.products.edges[0]?.node.featuredImage ??
                null;
              return (
                <Link
                  key={guide.id}
                  href={`/collections/${guide.collectionHandle}`}
                  className="group block"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-mist">
                    {img && (
                      <Image
                        src={img.url}
                        alt={img.altText ?? guide.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-cover transition duration-500 group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wide text-ink group-hover:underline">
                    {guide.title}
                  </h3>
                  <p className="mt-1 text-sm text-steel">{guide.description}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
