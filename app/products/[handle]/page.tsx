import Link from "next/link";
import { notFound } from "next/navigation";
import FavoriteButton from "@/app/components/favorite-button";
import ProductGallery from "@/app/components/product-gallery";
import { getProductByHandle } from "@/lib/products";
import { getSiteUrl } from "@/lib/site-url";
import VariantSelector from "./variant-selector";

export const instant = false;

type ProductPageProps = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params }: ProductPageProps) {
  const { handle } = await params;
  try {
    const product = await getProductByHandle(handle);
    if (!product) return { title: "Product" };
    const siteUrl = getSiteUrl();
    return {
      title: product.title,
      description: product.description.slice(0, 160) || undefined,
      ...(siteUrl
        ? {
            alternates: {
              canonical: `${siteUrl}/products/${product.handle}`,
            },
          }
        : {}),
      openGraph: {
        title: product.title,
        images: product.featuredImage?.url
          ? [{ url: product.featuredImage.url }]
          : undefined,
      },
    };
  } catch {
    return { title: "Product" };
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    notFound();
  }

  const images =
    product.images.length > 0
      ? product.images
      : product.featuredImage
        ? [product.featuredImage]
        : [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description || undefined,
    image: images.map((i) => i.url),
    brand: product.vendor ? { "@type": "Brand", name: product.vendor } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: product.priceRange.minVariantPrice.currencyCode,
      price: product.priceRange.minVariantPrice.amount,
      availability: product.availableForSale
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };

  // Escape < so product titles/descriptions cannot break out of the script tag.
  const jsonLdHtml = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
      />
      <Link
        href="/collections/all"
        className="mb-8 inline-flex min-h-11 items-center text-sm font-medium text-steel hover:text-ink hover:underline"
      >
        ← Back to catalog
      </Link>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <ProductGallery images={images} productTitle={product.title} />

        <section className="overflow-visible">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-steel">
            {[product.vendor, product.productType].filter(Boolean).join(" · ")}
          </p>

          <div className="flex items-start justify-between gap-4">
            <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              {product.title}
            </h1>
            <FavoriteButton productId={product.id} size="md" className="shrink-0" />
          </div>

          <VariantSelector variants={product.variants} />

          {product.description ? (
            <div className="mt-10 border-t border-mist pt-8">
              <h2 className="font-display text-lg font-semibold text-ink">
                Details
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-steel sm:text-base">
                {product.description}
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
