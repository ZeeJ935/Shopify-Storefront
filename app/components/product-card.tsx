import Image from "next/image";
import Link from "next/link";
import FavoriteButton from "@/app/components/favorite-button";
import { salePercentOff, type ProductListItem } from "@/lib/products";
import { primaryColorTag } from "@/lib/tag-classify";
import { formatMoneyValue } from "@/lib/money";

type ProductCardProps = {
  product: ProductListItem;
};

function hasNewTag(tags: string[]) {
  return tags.some((t) => t.trim().toLowerCase() === "new");
}

export default function ProductCard({ product }: ProductCardProps) {
  const primary = product.featuredImage ?? product.images[0] ?? null;
  const secondary =
    product.images.find((img) => img.url !== primary?.url) ?? null;
  const compareAt = product.compareAtPrice;
  const showCompareAt =
    compareAt !== null &&
    Number(compareAt.amount) >
      Number(product.priceRange.minVariantPrice.amount);
  const pct = salePercentOff(
    product.priceRange.minVariantPrice,
    showCompareAt ? compareAt : null,
  );
  const color = primaryColorTag(product.tags);
  const showNew = hasNewTag(product.tags);
  const inStock = product.availableForSale;

  return (
    <Link
      href={`/products/${product.handle}`}
      className="group relative flex h-full min-w-0 flex-col overflow-hidden focus-visible:outline-offset-4"
    >
      <article className="flex h-full flex-col">
        <div className="relative aspect-[4/5] overflow-hidden bg-mist">
          {primary ? (
            <>
              <Image
                src={primary.url}
                alt={primary.altText ?? product.title}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className={`object-cover object-center transition duration-300 ${
                  !inStock ? "opacity-60" : ""
                } ${
                  secondary && inStock
                    ? "group-hover:opacity-0"
                    : inStock
                      ? "group-hover:scale-[1.02]"
                      : ""
                }`}
              />
              {secondary && inStock && (
                <Image
                  src={secondary.url}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover object-center opacity-0 transition duration-300 group-hover:opacity-100 max-lg:hidden"
                  aria-hidden="true"
                />
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-steel">
              No image
            </div>
          )}

          <div className="absolute right-3 top-3 z-10">
            <FavoriteButton productId={product.id} />
          </div>

          <div className="absolute left-2 top-2 flex flex-col gap-1">
            {!inStock && (
              <span className="bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-snow">
                Out of stock
              </span>
            )}
            {inStock && showNew && (
              <span className="bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-snow">
                New
              </span>
            )}
            {inStock && pct !== null && (
              <span className="bg-sale px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-snow">
                −{pct}%
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-1 flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-steel">
            {[product.vendor, product.productType].filter(Boolean).join(" · ")}
          </p>
          <h3 className="line-clamp-2 min-h-[2.75rem] font-display text-base font-semibold leading-snug text-ink group-hover:underline">
            {product.title}
          </h3>
          {color && <p className="text-sm text-steel">{color}</p>}
          <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-1 text-sm">
            {inStock ? (
              <>
                <span
                  className={`font-semibold ${showCompareAt ? "text-sale" : "text-ink"}`}
                >
                  {formatMoneyValue(product.priceRange.minVariantPrice)}
                </span>
                {showCompareAt && compareAt && (
                  <span className="text-steel line-through">
                    {formatMoneyValue(compareAt)}
                  </span>
                )}
              </>
            ) : (
              <span className="font-semibold uppercase tracking-wide text-steel">
                Out of stock
              </span>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
