"use client";

import type { ReactNode } from "react";
import { CartProvider } from "./cart-provider";
import { FavoritesProvider } from "./favorites-provider";
import { StorefrontToastProvider } from "./storefront-toast";

export default function FavoritesRoot({ children }: { children: ReactNode }) {
  return (
    <StorefrontToastProvider>
      <CartProvider>
        <FavoritesProvider>{children}</FavoritesProvider>
      </CartProvider>
    </StorefrontToastProvider>
  );
}
