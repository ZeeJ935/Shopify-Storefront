import {
  getCheckoutAllowedHosts,
  isSafeShopifyCheckoutUrl,
} from "./checkout-url";
import { shopifyFetch } from "./shopify";

type Money = {
  amount: string;
  currencyCode: string;
};

type CartLineInput = {
  merchandiseId: string;
  quantity: number;
};

type CartLineUpdateInput = {
  id: string;
  quantity: number;
};

type CartDiscountCode = {
  code: string;
  applicable: boolean;
};

type CartDiscountApplication = {
  totalAllocatedAmount: Money;
  code?: string;
  title?: string;
};

type CartDiscountAllocation = {
  discountedAmount: Money;
  sourceDiscountApplication: {
    code?: string;
    title?: string;
  };
};

type CartLineNode = {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    availableForSale: boolean;
    currentlyNotInStock: boolean;
    quantityAvailable: number | null;
    image: {
      url: string;
      altText: string | null;
    } | null;
    product: {
      title: string;
      handle: string;
    };
  };
  discountAllocations: CartDiscountAllocation[];
  cost: {
    amountPerQuantity: Money;
    compareAtAmountPerQuantity: Money | null;
    subtotalAmount: Money;
    totalAmount: Money;
  };
};

type CartQueryCart = {
  id: string;
  checkoutUrl: string;
  updatedAt: string;
  totalQuantity: number;
  discountCodes: CartDiscountCode[];
  discountApplications: CartDiscountApplication[];
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
    checkoutChargeAmount: Money;
  };
  lines: {
    edges: {
      node: CartLineNode;
    }[];
  };
};

const moneyFields = `
  amount
  currencyCode
`;

const cartFields = `
  id
  checkoutUrl
  updatedAt
  totalQuantity
  discountCodes {
    code
    applicable
  }
  discountApplications {
    totalAllocatedAmount {
      ${moneyFields}
    }
    ... on CartCodeDiscountApplication {
      code
    }
    ... on CartAutomaticDiscountApplication {
      title
    }
  }
  cost {
    subtotalAmount {
      ${moneyFields}
    }
    totalAmount {
      ${moneyFields}
    }
    checkoutChargeAmount {
      ${moneyFields}
    }
  }
  lines(first: 100) {
    edges {
      node {
        id
        quantity
        merchandise {
          ... on ProductVariant {
            id
            title
            availableForSale
            currentlyNotInStock
            quantityAvailable
            image {
              url
              altText
            }
            product {
              title
              handle
            }
          }
        }
        discountAllocations(lineLevelOnly: false) {
          discountedAmount {
            ${moneyFields}
          }
          sourceDiscountApplication {
            ... on CartCodeDiscountApplication {
              code
            }
            ... on CartAutomaticDiscountApplication {
              title
            }
          }
        }
        cost {
          amountPerQuantity {
            ${moneyFields}
          }
          compareAtAmountPerQuantity {
            ${moneyFields}
          }
          subtotalAmount {
            ${moneyFields}
          }
          totalAmount {
            ${moneyFields}
          }
        }
      }
    }
  }
`;

function isCompleteCartLine(line: CartLineNode): boolean {
  return (
    typeof line.id === "string" &&
    line.id.length > 0 &&
    typeof line.merchandise?.id === "string" &&
    line.merchandise.id.length > 0 &&
    typeof line.merchandise.product?.handle === "string" &&
    line.merchandise.product.handle.length > 0 &&
    typeof line.merchandise.product?.title === "string"
  );
}

function flattenCart(cart: CartQueryCart) {
  const { lines, ...rest } = cart;

  return {
    ...rest,
    // Drop incomplete lines (e.g. non-ProductVariant merchandise after inline fragment).
    lines: lines.edges.map((edge) => edge.node).filter(isCompleteCartLine),
  };
}

export type Cart = ReturnType<typeof flattenCart>;
export type CartLine = Cart["lines"][number];

/**
 * Non-blocking notices from cart mutations. For stock, Shopify caps the line
 * at what's available and reports it here instead of in userErrors.
 */
export type CartWarning = {
  code: string;
  message: string;
  /** Usually the affected cart line id. */
  target: string;
};

export type CartMutationResult = {
  cart: Cart;
  warnings: CartWarning[];
};

const warningFields = `
  warnings {
    code
    message
    target
  }
`;

/** Blanks an unsafe checkout URL before the cart is sent to the browser. */
export function toClientCart(cart: Cart): Cart {
  const safe = isSafeShopifyCheckoutUrl(
    cart.checkoutUrl,
    getCheckoutAllowedHosts(),
  );
  return safe ? cart : { ...cart, checkoutUrl: "" };
}

function assertNonEmptyId(value: string, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
}

function assertUpdateQuantity(quantity: number) {
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99
  ) {
    throw new Error("Quantity must be a whole number between 1 and 99.");
  }
}

/** Creates a cart, optionally with initial lines, in a single request. */
export async function createCart(
  lines: CartLineInput[] = [],
  /** Storefront customer token of a signed-in shopper, linking the cart to them. */
  customerAccessToken?: string,
): Promise<CartMutationResult> {
  for (const line of lines) {
    assertNonEmptyId(line.merchandiseId, "Merchandise ID");
    assertUpdateQuantity(line.quantity);
  }

  const data = await shopifyFetch<{
    cartCreate: {
      cart: CartQueryCart | null;
      userErrors: { message: string }[];
      warnings: CartWarning[];
    };
  }>(
    `mutation CartCreate($input: CartInput) {
      cartCreate(input: $input) {
        cart {
          ${cartFields}
        }
        userErrors {
          message
        }
        ${warningFields}
      }
    }`,
    {
      input: {
        lines: lines.map((line) => ({
          merchandiseId: line.merchandiseId.trim(),
          quantity: line.quantity,
        })),
        ...(customerAccessToken
          ? { buyerIdentity: { customerAccessToken } }
          : {}),
      },
    },
  );

  const { cart, userErrors, warnings } = data.cartCreate;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return a cart.");
  }

  return { cart: flattenCart(cart), warnings };
}

export async function addToCart(
  cartId: string,
  merchandiseId: string,
  quantity: number = 1,
): Promise<CartMutationResult> {
  assertNonEmptyId(cartId, "Cart ID");
  assertNonEmptyId(merchandiseId, "Merchandise ID");
  assertUpdateQuantity(quantity);

  const data = await shopifyFetch<{
    cartLinesAdd: {
      cart: CartQueryCart | null;
      userErrors: { message: string }[];
      warnings: CartWarning[];
    };
  }>(
    `mutation CartLinesAdd(
      $cartId: ID!,
      $lines: [CartLineInput!]!
    ) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart {
          ${cartFields}
        }
        userErrors {
          message
        }
        ${warningFields}
      }
    }`,
    {
      cartId: cartId.trim(),
      lines: [
        {
          merchandiseId: merchandiseId.trim(),
          quantity,
        },
      ],
    },
  );

  const { cart, userErrors, warnings } = data.cartLinesAdd;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }

  return { cart: flattenCart(cart), warnings };
}

/**
 * Associates an existing cart with a signed-in customer, so checkout is tied
 * to their account and can prefill their details.
 */
export async function linkCartToCustomer(
  cartId: string,
  customerAccessToken: string,
) {
  assertNonEmptyId(cartId, "Cart ID");
  assertNonEmptyId(customerAccessToken, "Customer access token");

  const data = await shopifyFetch<{
    cartBuyerIdentityUpdate: {
      cart: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    `mutation CartBuyerIdentityUpdate(
      $cartId: ID!,
      $buyerIdentity: CartBuyerIdentityInput!
    ) {
      cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
        cart {
          id
        }
        userErrors {
          message
        }
      }
    }`,
    {
      cartId: cartId.trim(),
      buyerIdentity: { customerAccessToken },
    },
  );

  const { cart, userErrors } = data.cartBuyerIdentityUpdate;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }
}

export async function getCart(cartId: string) {
  const data = await shopifyFetch<{
    cart: CartQueryCart | null;
  }>(
    `query GetCart($cartId: ID!) {
      cart(id: $cartId) {
        ${cartFields}
      }
    }`,
    { cartId },
  );

  if (!data.cart) {
    return null;
  }

  return flattenCart(data.cart);
}

/** Updates one or more line quantities in a single request. */
export async function updateCartLines(
  cartId: string,
  lines: CartLineUpdateInput[],
): Promise<CartMutationResult> {
  assertNonEmptyId(cartId, "Cart ID");

  if (lines.length === 0) {
    throw new Error("At least one cart line is required.");
  }

  for (const line of lines) {
    assertNonEmptyId(line.id, "Line ID");
    assertUpdateQuantity(line.quantity);
  }

  const data = await shopifyFetch<{
    cartLinesUpdate: {
      cart: CartQueryCart | null;
      userErrors: { message: string }[];
      warnings: CartWarning[];
    };
  }>(
    `mutation CartLinesUpdate(
      $cartId: ID!,
      $lines: [CartLineUpdateInput!]!
    ) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart {
          ${cartFields}
        }
        userErrors {
          message
        }
        ${warningFields}
      }
    }`,
    {
      cartId: cartId.trim(),
      lines: lines.map((line) => ({
        id: line.id.trim(),
        quantity: line.quantity,
      })),
    },
  );

  const { cart, userErrors, warnings } = data.cartLinesUpdate;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }

  return { cart: flattenCart(cart), warnings };
}

export async function removeCartLine(cartId: string, lineId: string) {
  assertNonEmptyId(cartId, "Cart ID");
  assertNonEmptyId(lineId, "Line ID");

  const data = await shopifyFetch<{
    cartLinesRemove: {
      cart: CartQueryCart | null;
      userErrors: { message: string }[];
    };
  }>(
    `mutation CartLinesRemove(
      $cartId: ID!,
      $lineIds: [ID!]!
    ) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart {
          ${cartFields}
        }
        userErrors {
          message
        }
      }
    }`,
    {
      cartId: cartId.trim(),
      lineIds: [lineId.trim()],
    },
  );

  const { cart, userErrors } = data.cartLinesRemove;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }

  return flattenCart(cart);
}

export async function updateCartDiscountCodes(
  cartId: string,
  discountCodes: string[],
) {
  assertNonEmptyId(cartId, "Cart ID");

  if (
    !Array.isArray(discountCodes) ||
    discountCodes.some(
      (code) => typeof code !== "string" || code.trim().length === 0,
    )
  ) {
    throw new Error("Discount codes must be a list of non-empty strings.");
  }

  const data = await shopifyFetch<{
    cartDiscountCodesUpdate: {
      cart: CartQueryCart | null;
      userErrors: { message: string }[];
    };
  }>(
    `mutation CartDiscountCodesUpdate(
      $cartId: ID!,
      $discountCodes: [String!]!
    ) {
      cartDiscountCodesUpdate(
        cartId: $cartId,
        discountCodes: $discountCodes
      ) {
        cart {
          ${cartFields}
        }
        userErrors {
          message
        }
      }
    }`,
    {
      cartId: cartId.trim(),
      discountCodes: discountCodes.map((code) => code.trim()),
    },
  );

  const { cart, userErrors } = data.cartDiscountCodesUpdate;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }

  return flattenCart(cart);
}
