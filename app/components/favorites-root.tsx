"use client";

import type { ReactNode } from "react";
import { FavoritesProvider } from "./favorites-provider";
import { StorefrontToastProvider } from "./storefront-toast";

export default function FavoritesRoot({ children }: { children: ReactNode }) {
  return (
    <StorefrontToastProvider>
      <FavoritesProvider>{children}</FavoritesProvider>
    </StorefrontToastProvider>
  );
}
