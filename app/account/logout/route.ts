import { connection } from "next/server";
import { NextResponse } from "next/server";
import { CART_COOKIE, cartCookieClearOptions } from "@/lib/cart-cookie";
import { buildCustomerLogoutUrl } from "@/lib/customer-account/oauth";
import {
  clearCustomerSessionCookies,
  getCustomerSession,
} from "@/lib/customer-account/session";

/**
 * Logout must be POST-only. Next.js <Link> prefetches GET routes, which was
 * wiping session cookies whenever Account UI appeared in the viewport.
 */
export async function POST(request: Request) {
  await connection();
  const session = await getCustomerSession();

  let logoutUrl = new URL("/", request.url).toString();
  try {
    logoutUrl = await buildCustomerLogoutUrl(session?.idToken);
  } catch (error) {
    console.error("[account/logout]", error);
  }

  const response = NextResponse.redirect(logoutUrl, 303);
  clearCustomerSessionCookies(response);
  // The cart is linked to this customer; don't leave it for the next person
  // on a shared device to check out under their account.
  response.cookies.set(CART_COOKIE, "", cartCookieClearOptions());
  return response;
}

export async function GET(request: Request) {
  await connection();
  // Do not clear cookies on GET (prefetch-safe).
  return NextResponse.redirect(new URL("/account", request.url), 302);
}
