import { NextResponse, type NextRequest } from "next/server";
import { getCart } from "@/lib/cart";
import {
  CART_COOKIE,
  cartCookieClearOptions,
} from "@/lib/cart-cookie";

/**
 * Clears an expired/invalid cart cookie, then returns to the cart page.
 * It checks with Shopify first, so a cross-site link here can't empty a
 * working cart.
 */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/cart", request.url), 302);
  const cartId = request.cookies.get(CART_COOKIE)?.value;
  if (!cartId) {
    return response;
  }

  let cartGone = false;
  try {
    cartGone = (await getCart(cartId)) === null;
  } catch {
    // Shopify unreachable: keep the cookie rather than lose a working cart.
  }

  if (cartGone) {
    response.cookies.set(CART_COOKIE, "", cartCookieClearOptions());
  }
  return response;
}
