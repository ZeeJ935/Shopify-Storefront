import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ProductCard from "@/app/components/product-card";
import SiteContainer from "@/app/components/site-container";
import { getCart } from "@/lib/cart";
import { CART_COOKIE } from "@/lib/cart-cookie";
import {
  getCheckoutAllowedHosts,
  isSafeShopifyCheckoutUrl,
} from "@/lib/checkout-url";
import { getProducts, type ProductListItem } from "@/lib/products";
import CartView from "./cart-view";


async function loadRecommendations(): Promise<ProductListItem[]> {
  try {
    const result = await getProducts({ first: 8, sortKey: "BEST_SELLING" });
    return result.products;
  } catch {
    return [];
  }
}

function EmptyBag({
  title,
  description,
  recommendations,
}: {
  title: string;
  description: string;
  recommendations: ProductListItem[];
}) {
  const featured = recommendations.slice(0, 4);

  return (
    <main>
      <SiteContainer boxed className="py-14 sm:py-20">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-base text-steel">{description}</p>
        <Link href="/collections/all" className="btn btn-primary mt-8">
          Continue shopping
        </Link>
      </div>

      {featured.length > 0 ? (
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
      ) : null}
      </SiteContainer>
    </main>
  );
}

export default async function CartPage() {
  const cookieStore = await cookies();
  const cartId = cookieStore.get(CART_COOKIE)?.value;
  const recommendationsPromise = loadRecommendations();

  if (!cartId) {
    const recommendations = await recommendationsPromise;
    return (
      <EmptyBag
        title="Your bag is empty"
        description="Looks like you haven't added anything yet. Explore the catalog and find your next gear."
        recommendations={recommendations}
      />
    );
  }

  let cart;

  try {
    cart = await getCart(cartId);
  } catch {
    const recommendations = await recommendationsPromise;
    return (
      <EmptyBag
        title="Unable to load bag"
        description="Something went wrong while loading your bag. Please try again in a moment."
        recommendations={recommendations}
      />
    );
  }

  if (!cart) {
    redirect("/cart/clear");
  }

  const recommendations = await recommendationsPromise;

  if (cart.lines.length === 0) {
    return (
      <EmptyBag
        title="Your bag is empty"
        description="Your bag doesn't have any items yet. Browse the catalog to add products."
        recommendations={recommendations}
      />
    );
  }

  const inCartHandles = new Set(
    cart.lines.map((line) => line.merchandise.product.handle),
  );
  const filteredRecommendations = recommendations
    .filter((product) => !inCartHandles.has(product.handle))
    .slice(0, 4);

  const allowedHosts = getCheckoutAllowedHosts();
  const checkoutUrl = isSafeShopifyCheckoutUrl(cart.checkoutUrl, allowedHosts)
    ? cart.checkoutUrl
    : "";

  return (
    <main>
      <CartView
        cart={{ ...cart, checkoutUrl }}
        checkoutAllowedHosts={allowedHosts}
        recommendations={filteredRecommendations}
      />
    </main>
  );
}
