import { cacheLife } from "next/cache";
import ProductCard from "@/app/components/product-card";
import { getProducts, type ProductListItem } from "@/lib/products";

// Kept here, not in lib/products: client components import that module.
async function getCartRecommendations(): Promise<ProductListItem[]> {
  "use cache";
  cacheLife("hours");

  const result = await getProducts({ first: 8, sortKey: "BEST_SELLING" });
  return result.products;
}

type CartRecommendationsProps = {
  excludeHandles: string[];
};

export default async function CartRecommendations({
  excludeHandles,
}: CartRecommendationsProps) {
  let products: ProductListItem[];

  try {
    products = await getCartRecommendations();
  } catch {
    return null;
  }

  const featured = products
    .filter((product) => !excludeHandles.includes(product.handle))
    .slice(0, 4);

  if (featured.length === 0) {
    return null;
  }

  return (
    <section className="mt-16 border-t border-mist pt-12 sm:mt-20 sm:pt-16">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-ink sm:text-2xl">
        You may also like
      </h2>
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
        {featured.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
