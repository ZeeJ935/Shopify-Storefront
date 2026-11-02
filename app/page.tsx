import Image from "next/image";
import Link from "next/link";
import PopularTabs from "./components/popular-tabs";
import ProductCarousel from "./components/product-carousel";
import SiteContainer from "./components/site-container";
import { getNavCatalog } from "@/lib/catalog";
import { getCollectionProductsPreview } from "@/lib/collections";
import { getProducts } from "@/lib/products";
import { brandBenefits, heroSlides, siteBrand } from "@/lib/site-content";
import { canonicalFor } from "@/lib/site-url";

// Title/description come from the root layout.
export const metadata = {
  alternates: canonicalFor("/"),
};

const liveBenefits = brandBenefits.filter((benefit) => !benefit.demo);

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
    getCollectionProductsPreview("sale", 12),
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
        <SiteContainer className="relative flex min-h-[72vh] flex-col justify-end py-16 sm:py-20 lg:py-24">
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
        </SiteContainer>
      </section>

      {/* Trending */}
      {trendingProducts.length > 0 && (
        <section className="py-14 lg:py-20">
          <SiteContainer>
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
          </SiteContainer>
        </section>
      )}

      {/* Sale strip */}
      {sale && sale.length > 0 && (
        <section className="bg-ink py-16 text-snow lg:py-24">
          <SiteContainer>
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
            <ProductCarousel
              products={sale}
              label="Sale products"
              tone="dark"
            />
          </SiteContainer>
        </section>
      )}

      {/* Shop by category */}
      {catalog.productTypeTiles.length > 0 && (
        <section className="bg-white py-14 lg:py-20">
          <SiteContainer>
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
          </SiteContainer>
        </section>
      )}

      {/* Shop by brand */}
      {catalog.brandTiles.length > 0 && (
        <section className="py-14 lg:py-20">
          <SiteContainer>
            <h2 className="display-section mb-8 text-ink">Shop by brand</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {catalog.brandTiles.map((brand) => (
                <Link
                  key={brand.label}
                  href={brand.href}
                  className="group relative min-h-72 overflow-hidden bg-mist sm:min-h-96 lg:min-h-[28rem]"
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
          </SiteContainer>
        </section>
      )}

      {/* Popular right now */}
      {((men && men.length > 0) || (women && women.length > 0)) && (
        <section className="bg-white py-14 lg:py-20">
          <SiteContainer>
            <h2 className="display-section mb-8 text-ink">Popular right now</h2>
            <PopularTabs men={men ?? []} women={women ?? []} />
          </SiteContainer>
        </section>
      )}

      {/* New arrivals */}
      {newest.length > 0 && (
        <section className="py-14 lg:py-20">
          <SiteContainer>
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
          </SiteContainer>
        </section>
      )}

      {/* Brand / value strip: demo claims (shipping, returns) stay hidden until real. */}
      {liveBenefits.length >= 2 ? (
        <section className="border-y border-mist bg-white py-12">
          <SiteContainer className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {liveBenefits.map((b) => (
              <div key={b.id}>
                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                  {b.title}
                </h3>
                <p className="mt-2 text-sm text-steel">{b.description}</p>
              </div>
            ))}
          </SiteContainer>
        </section>
      ) : null}
    </main>
  );
}
