"use client";

import { useEffect } from "react";
import { writeFavouritesIntent } from "@/lib/favourites";

export default function LoginIntentCapture({
  returnTo,
  addProductId,
}: {
  returnTo: string;
  addProductId?: string;
}) {
  useEffect(() => {
    writeFavouritesIntent({ returnTo, addProductId });
  }, [returnTo, addProductId]);

  return null;
}
