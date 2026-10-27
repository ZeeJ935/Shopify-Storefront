import { shopifyFetch } from "./shopify";

type Money = {
  amount: string;
  currencyCode: string;
};

type ShopifyCart = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
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

export async function createCart() {
  const data = await shopifyFetch<{
    cartCreate: {
      cart: ShopifyCart | null;
      userErrors: { message: string }[];
    };
  }>(
    `mutation CartCreate {
      cartCreate {
        cart {
          id
          checkoutUrl
          totalQuantity
        }
        userErrors {
          message
        }
      }
    }`,
  );

  const { cart, userErrors } = data.cartCreate;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return a cart.");
  }

  return cart;
}

export async function addToCart(
  cartId: string,
  merchandiseId: string,
  quantity: number = 1,
) {
  assertNonEmptyId(cartId, "Cart ID");
  assertNonEmptyId(merchandiseId, "Merchandise ID");
  assertUpdateQuantity(quantity);

  const data = await shopifyFetch<{
    cartLinesAdd: {
      cart: ShopifyCart | null;
      userErrors: { message: string }[];
    };
  }>(
    `mutation CartLinesAdd(
      $cartId: ID!,
      $lines: [CartLineInput!]!
    ) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart {
          id
          checkoutUrl
          totalQuantity
        }
        userErrors {
          message
        }
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

  const { cart, userErrors } = data.cartLinesAdd;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }

  return cart;
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

export async function updateCartLine(
  cartId: string,
  lineId: string,
  quantity: number,
) {
  assertNonEmptyId(cartId, "Cart ID");
  assertNonEmptyId(lineId, "Line ID");
  assertUpdateQuantity(quantity);

  const data = await shopifyFetch<{
    cartLinesUpdate: {
      cart: CartQueryCart | null;
      userErrors: { message: string }[];
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
      }
    }`,
    {
      cartId: cartId.trim(),
      lines: [
        {
          id: lineId.trim(),
          quantity,
        },
      ],
    },
  );

  const { cart, userErrors } = data.cartLinesUpdate;

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  if (!cart) {
    throw new Error("Shopify did not return the updated cart.");
  }

  return flattenCart(cart);
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
