import { cookies } from "next/headers";
import { getCart } from "@/lib/cart";
import { CART_COOKIE } from "@/lib/cart-cookie";
import { getNavCatalog } from "@/lib/catalog";
import { hasCustomerSession } from "@/lib/customer-account/session";
import { siteBrand } from "@/lib/site-content";
import SiteHeaderShell from "./site-header-shell";

export default async function SiteHeader() {
  const cookieStore = await cookies();
  const cartId = cookieStore.get(CART_COOKIE)?.value;

  let totalQuantity = 0;
  if (cartId) {
    try {
      const cart = await getCart(cartId);
      totalQuantity = cart?.totalQuantity ?? 0;
    } catch {
      totalQuantity = 0;
    }
  }

  const [catalog, signedIn] = await Promise.all([
    getNavCatalog(),
    hasCustomerSession(),
  ]);

  return (
    <SiteHeaderShell
      links={catalog.links}
      brandTiles={catalog.brandTiles}
      productTypeTiles={catalog.productTypeTiles}
      hasTrending={catalog.collections.has("trending")}
      hasSale={catalog.collections.has("sale")}
      cartQuantity={totalQuantity}
      shopName={siteBrand.name}
      isAuthenticated={signedIn}
    />
  );
}
