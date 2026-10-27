import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCart } from "@/lib/cart";
import { CART_COOKIE } from "@/lib/cart-cookie";
import {
  getCheckoutAllowedHosts,
  isSafeShopifyCheckoutUrl,
} from "@/lib/checkout-url";
import CartView from "./cart-view";

export const instant = false;

function EmptyCart({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-14 sm:px-8 sm:py-20">
      <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 max-w-xl text-steel">{description}</p>
      <Link href="/#catalog" className="btn btn-primary mt-8">
        Continue shopping
      </Link>
    </main>
  );
}

export default async function CartPage() {
  const cookieStore = await cookies();
  const cartId = cookieStore.get(CART_COOKIE)?.value;

  if (!cartId) {
    return (
      <EmptyCart
        title="Your cart is empty"
        description="You haven't added any products yet. Browse the catalog to get started."
      />
    );
  }

  let cart;

  try {
    cart = await getCart(cartId);
  } catch {
    return (
      <EmptyCart
        title="Unable to load cart"
        description="Something went wrong while loading your cart. Please try again in a moment."
      />
    );
  }

  if (!cart) {
    // Cookie can only be cleared from a Route Handler / Server Action.
    redirect("/cart/clear");
  }

  if (cart.lines.length === 0) {
    return (
      <EmptyCart
        title="Your cart is empty"
        description="Your cart doesn't have any items yet. Browse the catalog to add products."
      />
    );
  }

  const allowedHosts = getCheckoutAllowedHosts();
  const checkoutUrl = isSafeShopifyCheckoutUrl(cart.checkoutUrl, allowedHosts)
    ? cart.checkoutUrl
    : "";

  return (
    <main>
      <CartView
        cart={{ ...cart, checkoutUrl }}
        checkoutAllowedHosts={allowedHosts}
      />
    </main>
  );
}
