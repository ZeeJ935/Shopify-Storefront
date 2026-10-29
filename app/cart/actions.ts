"use server";

import { cookies } from "next/headers";
import {
  addToCart,
  createCart,
  getCart,
  removeCartLine,
  toClientCart,
  updateCartDiscountCodes,
  updateCartLines,
  type Cart,
  type CartMutationResult,
} from "@/lib/cart";
import {
  CART_COOKIE,
  cartCookieClearOptions,
  cartCookieSetOptions,
} from "@/lib/cart-cookie";
import { getCustomerSession } from "@/lib/customer-account/session";

const DISCOUNT_CODE_MAX_LENGTH = 50;
const INVALID_DISCOUNT_MESSAGE =
  "This code isn't valid or doesn't apply to your cart.";
const CART_GONE_MESSAGE =
  "Your cart is no longer available. Add items from the store to start a new one.";

/** Something the shopper should know about a line, e.g. stock capped it. */
export type CartLineNotice = { lineId: string; message: string };

export type CartActionResult =
  | { success: true; cart: Cart; notices: CartLineNotice[] }
  | { success: false; message: string; cartGone?: boolean };

const SOLD_OUT_MESSAGE = "Sorry, this item just sold out.";

export type CartLineQuantity = { id: string; quantity: number };

function isInvalidCartError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("shopify api request failed") ||
    message.includes("shopify request timed out") ||
    message.includes("shopify network request failed") ||
    message.includes("shopify graphql request failed") ||
    message.includes("shopify returned") ||
    message.includes("missing shopify environment") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("timed out")
  ) {
    return false;
  }

  return (
    message.includes("cart does not exist") ||
    message.includes("cart not found") ||
    message.includes("invalid cart") ||
    message.includes("specified cart") ||
    message.includes("did not return the updated cart")
  );
}

function isValidQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 99
  );
}

async function readCartId() {
  const cookieStore = await cookies();
  return cookieStore.get(CART_COOKIE)?.value || null;
}

async function clearCartCookie() {
  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE, "", cartCookieClearOptions());
}

async function cartGone(): Promise<CartActionResult> {
  await clearCartCookie();
  return { success: false, message: CART_GONE_MESSAGE, cartGone: true };
}

function toNotices({ cart, warnings }: CartMutationResult): CartLineNotice[] {
  return warnings.map((warning) => {
    const line = cart.lines.find((item) => item.id === warning.target);

    if (warning.code === "MERCHANDISE_NOT_ENOUGH_STOCK" && line) {
      return {
        lineId: warning.target,
        message: `Only ${line.quantity} available. We've updated your bag.`,
      };
    }
    if (warning.code === "MERCHANDISE_OUT_OF_STOCK") {
      return { lineId: warning.target, message: SOLD_OUT_MESSAGE };
    }
    return { lineId: warning.target, message: warning.message };
  });
}

function ok(result: Cart | CartMutationResult): CartActionResult {
  if ("warnings" in result) {
    return {
      success: true,
      cart: toClientCart(result.cart),
      notices: toNotices(result),
    };
  }
  return { success: true, cart: toClientCart(result), notices: [] };
}

/** Shopify accepts an add of sold-out stock but leaves it out of the cart. */
function addResult(
  result: CartMutationResult,
  variantId: string,
): CartActionResult {
  const added = result.cart.lines.some(
    (line) => line.merchandise.id === variantId,
  );
  const soldOut = result.warnings.some(
    (warning) => warning.code === "MERCHANDISE_OUT_OF_STOCK",
  );
  if (!added && soldOut) {
    return { success: false, message: SOLD_OUT_MESSAGE };
  }
  return ok(result);
}

/** Read-only: the current cart for client hydration, or null when there is none. */
export async function getCurrentCart(): Promise<Cart | null> {
  const cartId = await readCartId();
  if (!cartId) {
    return null;
  }

  try {
    const cart = await getCart(cartId);
    return cart ? toClientCart(cart) : null;
  } catch {
    return null;
  }
}

async function createCartWithItem(
  variantId: string,
  quantity: number,
): Promise<CartActionResult> {
  // Signed-in shoppers get a cart tied to their account from the start.
  const session = await getCustomerSession();
  const result = await createCart(
    [{ merchandiseId: variantId, quantity }],
    session?.storefrontToken,
  );

  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE, result.cart.id, cartCookieSetOptions());

  return addResult(result, variantId);
}

export async function addItem(
  variantId: string,
  quantity: number,
): Promise<CartActionResult> {
  if (typeof variantId !== "string" || variantId.trim().length === 0) {
    return { success: false, message: "A product variant is required." };
  }

  if (!isValidQuantity(quantity)) {
    return {
      success: false,
      message: "Quantity must be a whole number between 1 and 99.",
    };
  }

  const trimmedVariantId = variantId.trim();
  const existingCartId = await readCartId();

  if (existingCartId) {
    try {
      return addResult(
        await addToCart(existingCartId, trimmedVariantId, quantity),
        trimmedVariantId,
      );
    } catch (error) {
      if (!isInvalidCartError(error)) {
        return {
          success: false,
          message: "Unable to update your cart. Please try again.",
        };
      }
      // Stale cart: fall through and start a new one.
    }
  }

  try {
    return await createCartWithItem(trimmedVariantId, quantity);
  } catch {
    return {
      success: false,
      message: "Unable to add this item to your cart. Please try again.",
    };
  }
}

export async function updateItems(
  lines: CartLineQuantity[],
): Promise<CartActionResult> {
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.some(
      (line) =>
        typeof line?.id !== "string" ||
        line.id.trim().length === 0 ||
        !isValidQuantity(line.quantity),
    )
  ) {
    return {
      success: false,
      message: "Quantity must be a whole number between 1 and 99.",
    };
  }

  const cartId = await readCartId();
  if (!cartId) {
    return cartGone();
  }

  try {
    return ok(await updateCartLines(cartId, lines));
  } catch (error) {
    if (isInvalidCartError(error)) {
      return cartGone();
    }
    return {
      success: false,
      message: "Unable to update your cart. Please try again.",
    };
  }
}

export async function removeItem(lineId: string): Promise<CartActionResult> {
  if (typeof lineId !== "string" || lineId.trim().length === 0) {
    return { success: false, message: "A cart line is required." };
  }

  const cartId = await readCartId();
  if (!cartId) {
    return cartGone();
  }

  try {
    return ok(await removeCartLine(cartId, lineId.trim()));
  } catch (error) {
    if (isInvalidCartError(error)) {
      return cartGone();
    }
    return {
      success: false,
      message: "Unable to remove this item. Please try again.",
    };
  }
}

function normalizeDiscountCodeInput(
  code: unknown,
): { ok: true; code: string } | { ok: false; error: string } {
  if (typeof code !== "string") {
    return { ok: false, error: "Enter a discount code." };
  }

  const trimmed = code.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a discount code." };
  }

  if (trimmed.length > DISCOUNT_CODE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Discount codes must be ${DISCOUNT_CODE_MAX_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, code: trimmed };
}

function dedupeCodesCaseInsensitive(codes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const code of codes) {
    const key = code.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(code);
  }

  return result;
}

function applicableCodes(cart: Cart) {
  return cart.discountCodes
    .filter((item) => item.applicable)
    .map((item) => item.code);
}

export async function applyDiscountCode(
  code: string,
): Promise<CartActionResult> {
  const normalized = normalizeDiscountCodeInput(code);
  if (!normalized.ok) {
    return { success: false, message: normalized.error };
  }

  const cartId = await readCartId();
  if (!cartId) {
    return cartGone();
  }

  try {
    // Shopify replaces the whole code list, so the current codes are needed.
    const current = await getCart(cartId);
    if (!current) {
      return cartGone();
    }

    const key = normalized.code.toLowerCase();
    const alreadyApplied = current.discountCodes.some(
      (item) => item.applicable && item.code.toLowerCase() === key,
    );
    if (alreadyApplied) {
      return ok(current);
    }

    const updated = await updateCartDiscountCodes(
      cartId,
      dedupeCodesCaseInsensitive([...applicableCodes(current), normalized.code]),
    );

    const applied = updated.discountCodes.find(
      (item) => item.code.toLowerCase() === key,
    );

    if (!applied?.applicable) {
      await updateCartDiscountCodes(cartId, applicableCodes(updated));
      return { success: false, message: INVALID_DISCOUNT_MESSAGE };
    }

    if (updated.discountCodes.some((item) => !item.applicable)) {
      return ok(await updateCartDiscountCodes(cartId, applicableCodes(updated)));
    }

    return ok(updated);
  } catch (error) {
    if (isInvalidCartError(error)) {
      return cartGone();
    }
    return {
      success: false,
      message: "Unable to apply this discount code. Please try again.",
    };
  }
}

export async function removeDiscountCode(
  code: string,
  currentCodes: string[],
): Promise<CartActionResult> {
  const normalized = normalizeDiscountCodeInput(code);
  if (!normalized.ok) {
    return { success: false, message: normalized.error };
  }

  if (
    !Array.isArray(currentCodes) ||
    currentCodes.some((item) => typeof item !== "string")
  ) {
    return { success: false, message: "Unable to remove this discount code." };
  }

  const cartId = await readCartId();
  if (!cartId) {
    return cartGone();
  }

  const key = normalized.code.toLowerCase();
  const nextCodes = currentCodes
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.toLowerCase() !== key);

  try {
    return ok(await updateCartDiscountCodes(cartId, nextCodes));
  } catch (error) {
    if (isInvalidCartError(error)) {
      return cartGone();
    }
    return {
      success: false,
      message: "Unable to remove this discount code. Please try again.",
    };
  }
}
