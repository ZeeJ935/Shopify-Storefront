import { NextResponse } from "next/server";
import {
  CART_COOKIE,
  cartCookieClearOptions,
} from "@/lib/cart-cookie";

/** Clears an expired/invalid cart cookie, then returns to the cart page. */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/cart", request.url), 302);
  response.cookies.set(CART_COOKIE, "", cartCookieClearOptions());
  return response;
}
