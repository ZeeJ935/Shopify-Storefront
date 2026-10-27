export const CART_COOKIE = "shopify-cart-id";
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function cartCookieSetOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Attributes required to reliably clear a previously set cart cookie. */
export function cartCookieClearOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  };
}
