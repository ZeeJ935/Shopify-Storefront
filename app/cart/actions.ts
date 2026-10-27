"use server";

import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  addToCart,
  createCart,
  getCart,
  removeCartLine,
  updateCartDiscountCodes,
  updateCartLine,
} from "@/lib/cart";
import {
  CART_COOKIE,
  cartCookieClearOptions,
  cartCookieSetOptions,
} from "@/lib/cart-cookie";

const DISCOUNT_CODE_MAX_LENGTH = 50;
const INVALID_DISCOUNT_MESSAGE =
  "This code isn't valid or doesn't apply to your cart.";

type CartActionResult =
  | { success: true; totalQuantity: number }
  | { success: false; message: string };

type DiscountActionResult = { ok: true } | { ok: false; error: string };

type AddItemResult = CartActionResult;

function afterCartMutation() {
  revalidatePath("/cart");
  refresh();
}

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

async function createCartWithItem(
  variantId: string,
  quantity: number,
): Promise<AddItemResult> {
  const cart = await createCart();
  const updatedCart = await addToCart(cart.id, variantId, quantity);

  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE, updatedCart.id, cartCookieSetOptions());

  afterCartMutation();

  return {
    success: true,
    totalQuantity: updatedCart.totalQuantity,
  };
}

export async function addItem(
  variantId: string,
  quantity: number,
): Promise<AddItemResult> {
  if (typeof variantId !== "string" || variantId.trim().length === 0) {
    return { success: false, message: "A product variant is required." };
  }

  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99
  ) {
    return {
      success: false,
      message: "Quantity must be a whole number between 1 and 99.",
    };
  }

  const trimmedVariantId = variantId.trim();
  const cookieStore = await cookies();
  const existingCartId = cookieStore.get(CART_COOKIE)?.value;

  if (existingCartId) {
    let existingCart;

    try {
      existingCart = await getCart(existingCartId);
    } catch {
      return {
        success: false,
        message: "Unable to load your cart. Please try again.",
      };
    }

    if (existingCart) {
      try {
        const updatedCart = await addToCart(
          existingCartId,
          trimmedVariantId,
          quantity,
        );

        afterCartMutation();

        return {
          success: true,
          totalQuantity: updatedCart.totalQuantity,
        };
      } catch (error) {
        if (!isInvalidCartError(error)) {
          return {
            success: false,
            message: "Unable to update your cart. Please try again.",
          };
        }
      }
    }

    try {
      return await createCartWithItem(trimmedVariantId, quantity);
    } catch {
      return {
        success: false,
        message: "Unable to create a new cart. Please try again.",
      };
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

async function clearCartCookie() {
  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE, "", cartCookieClearOptions());
}

async function getActiveCartId(): Promise<
  | { ok: true; cartId: string }
  | { ok: false; result: CartActionResult }
> {
  const cookieStore = await cookies();
  const cartId = cookieStore.get(CART_COOKIE)?.value;

  if (!cartId) {
    return {
      ok: false,
      result: {
        success: false,
        message: "Your cart is empty. Add a product to get started.",
      },
    };
  }

  let cart;

  try {
    cart = await getCart(cartId);
  } catch {
    return {
      ok: false,
      result: {
        success: false,
        message: "Unable to load your cart. Please try again.",
      },
    };
  }

  if (!cart) {
    await clearCartCookie();
    return {
      ok: false,
      result: {
        success: false,
        message:
          "Your cart is no longer available. Add items from the store to start a new one.",
      },
    };
  }

  return { ok: true, cartId };
}

export async function updateItem(
  lineId: string,
  quantity: number,
): Promise<CartActionResult> {
  if (typeof lineId !== "string" || lineId.trim().length === 0) {
    return { success: false, message: "A cart line is required." };
  }

  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99
  ) {
    return {
      success: false,
      message: "Quantity must be a whole number between 1 and 99.",
    };
  }

  const activeCart = await getActiveCartId();
  if (!activeCart.ok) {
    return activeCart.result;
  }

  try {
    const updatedCart = await updateCartLine(
      activeCart.cartId,
      lineId.trim(),
      quantity,
    );

    afterCartMutation();

    return {
      success: true,
      totalQuantity: updatedCart.totalQuantity,
    };
  } catch {
    return {
      success: false,
      message: "Unable to update this item. Please try again.",
    };
  }
}

export async function removeItem(lineId: string): Promise<CartActionResult> {
  if (typeof lineId !== "string" || lineId.trim().length === 0) {
    return { success: false, message: "A cart line is required." };
  }

  const activeCart = await getActiveCartId();
  if (!activeCart.ok) {
    return activeCart.result;
  }

  try {
    const updatedCart = await removeCartLine(
      activeCart.cartId,
      lineId.trim(),
    );

    afterCartMutation();

    return {
      success: true,
      totalQuantity: updatedCart.totalQuantity,
    };
  } catch {
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

async function getActiveCartForDiscount(): Promise<
  | {
      ok: true;
      cartId: string;
      discountCodes: { code: string; applicable: boolean }[];
    }
  | { ok: false; error: string }
> {
  const activeCart = await getActiveCartId();
  if (!activeCart.ok) {
    return {
      ok: false,
      error: activeCart.result.success
        ? "Unable to load your cart. Please try again."
        : activeCart.result.message,
    };
  }

  let cart;

  try {
    cart = await getCart(activeCart.cartId);
  } catch {
    return { ok: false, error: "Unable to load your cart. Please try again." };
  }

  if (!cart) {
    await clearCartCookie();
    return {
      ok: false,
      error:
        "Your cart is no longer available. Add items from the store to start a new one.",
    };
  }

  return {
    ok: true,
    cartId: activeCart.cartId,
    discountCodes: cart.discountCodes,
  };
}

async function keepApplicableCodesOnly(
  cartId: string,
  discountCodes: { code: string; applicable: boolean }[],
) {
  const applicable = discountCodes
    .filter((item) => item.applicable)
    .map((item) => item.code);

  return updateCartDiscountCodes(cartId, applicable);
}

export async function applyDiscountCode(
  code: string,
): Promise<DiscountActionResult> {
  const normalized = normalizeDiscountCodeInput(code);
  if (!normalized.ok) {
    return normalized;
  }

  const active = await getActiveCartForDiscount();
  if (!active.ok) {
    return active;
  }

  const existingApplicable = active.discountCodes.find(
    (item) =>
      item.applicable &&
      item.code.toLowerCase() === normalized.code.toLowerCase(),
  );

  if (existingApplicable) {
    afterCartMutation();
    return { ok: true };
  }

  const nextCodes = dedupeCodesCaseInsensitive([
    ...active.discountCodes
      .filter((item) => item.applicable)
      .map((item) => item.code),
    normalized.code,
  ]);

  try {
    const updatedCart = await updateCartDiscountCodes(active.cartId, nextCodes);

    const applied = updatedCart.discountCodes.find(
      (item) => item.code.toLowerCase() === normalized.code.toLowerCase(),
    );

    if (!applied?.applicable) {
      await keepApplicableCodesOnly(active.cartId, updatedCart.discountCodes);
      afterCartMutation();
      return { ok: false, error: INVALID_DISCOUNT_MESSAGE };
    }

    if (updatedCart.discountCodes.some((item) => !item.applicable)) {
      await keepApplicableCodesOnly(active.cartId, updatedCart.discountCodes);
    }

    afterCartMutation();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Unable to apply this discount code. Please try again.",
    };
  }
}

export async function removeDiscountCode(
  code: string,
): Promise<DiscountActionResult> {
  const normalized = normalizeDiscountCodeInput(code);
  if (!normalized.ok) {
    return normalized;
  }

  const active = await getActiveCartForDiscount();
  if (!active.ok) {
    return active;
  }

  const nextCodes = active.discountCodes
    .map((item) => item.code)
    .filter((item) => item.toLowerCase() !== normalized.code.toLowerCase());

  try {
    await updateCartDiscountCodes(active.cartId, nextCodes);
    afterCartMutation();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Unable to remove this discount code. Please try again.",
    };
  }
}
