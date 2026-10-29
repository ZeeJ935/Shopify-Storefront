import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import SiteContainer from "@/app/components/site-container";
import { getCart, toClientCart, type Cart } from "@/lib/cart";
import { CART_COOKIE } from "@/lib/cart-cookie";
import CartRecommendations from "./cart-recommendations";
import CartView from "./cart-view";
import EmptyBag from "./empty-bag";

function Recommendations({ cart }: { cart: Cart | null }) {
  const inCartHandles = cart
    ? cart.lines.map((line) => line.merchandise.product.handle)
    : [];

  return (
    <Suspense fallback={null}>
      <CartRecommendations excludeHandles={inCartHandles} />
    </Suspense>
  );
}

export default async function CartPage() {
  const cookieStore = await cookies();
  const cartId = cookieStore.get(CART_COOKIE)?.value;

  let cart: Cart | null = null;

  if (cartId) {
    let fetched;

    try {
      fetched = await getCart(cartId);
    } catch {
      return (
        <main>
          <SiteContainer boxed className="py-14 sm:py-20">
            <EmptyBag
              title="Unable to load bag"
              description="Something went wrong while loading your bag. Please try again in a moment."
            />
            <Recommendations cart={null} />
          </SiteContainer>
        </main>
      );
    }

    if (!fetched) {
      redirect("/cart/clear");
    }

    cart = toClientCart(fetched);
  }

  return (
    <main>
      <CartView
        initialCart={cart}
        recommendations={<Recommendations cart={cart} />}
      />
    </main>
  );
}
