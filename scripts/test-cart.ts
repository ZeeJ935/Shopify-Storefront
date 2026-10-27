
import { createCart, addToCart } from "../lib/cart";
import { getProductByHandle } from "../lib/products";

async function main() {
  const handle = process.argv[2];

  if (!handle) {
    throw new Error(
      "Pass a product handle, e.g. npm run test:cart -- minimal-snowboard"
    );
  }

  const product = await getProductByHandle(handle);

  if (!product) {
    throw new Error(`Product not found: ${handle}`);
  }

  const variant = product.variants.find(
    (item) => item.availableForSale
  );

  if (!variant) {
    throw new Error("No available variants for this product.");
  }

  const cart = await createCart();

  console.log("Cart created:", {
    totalQuantity: cart.totalQuantity,
  });

  const updatedCart = await addToCart(
    cart.id,
    variant.id,
    1
  );

  console.log("Product added successfully:", {
    totalQuantity: updatedCart.totalQuantity,
    variant: variant.title,
    price: variant.price,
  });

  console.log("Checkout URL:", updatedCart.checkoutUrl);
}

main().catch((error) => {
  console.error("Cart test failed:", error);
  process.exitCode = 1;
});
