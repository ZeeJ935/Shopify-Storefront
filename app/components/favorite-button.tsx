"use client";

import { useHasMounted } from "@/app/hooks/use-has-mounted";
import { useFavorites } from "./favorites-provider";

type FavoriteButtonProps = {
  productId: string;
  className?: string;
  size?: "sm" | "md";
};

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-[1.15em] w-[1.15em]"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.5 12.572 12 20l-7.5-7.428A4.75 4.75 0 0 1 12 5.246a4.75 4.75 0 0 1 7.5 7.326Z" />
    </svg>
  );
}

export default function FavoriteButton({
  productId,
  className = "",
  size = "sm",
}: FavoriteButtonProps) {
  const { hydrated, authenticated, isFavourite, toggle } = useFavorites();
  // Matches the server HTML on hydration, then shows real state (see hook).
  const mounted = useHasMounted();
  const signedIn = mounted && authenticated;
  const active = mounted && hydrated && authenticated && isFavourite(productId);
  const dim = size === "md" ? "h-11 w-11 text-base" : "h-9 w-9 text-sm";

  return (
    <button
      type="button"
      className={`inline-flex ${dim} items-center justify-center rounded-full bg-snow text-ink shadow-md transition duration-150 hover:scale-105 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95 ${
        active ? "text-sale" : "text-ink"
      } ${className}`.trim()}
      aria-pressed={active}
      // The provider ignores clicks until favourites have loaded.
      aria-label={
        !signedIn
          ? "Sign in to save favourites"
          : active
            ? "Remove from favourites"
            : "Add to favourites"
      }
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(productId);
      }}
    >
      <span
        className={`inline-flex transition-transform duration-150 ${active ? "scale-110" : "scale-100"}`}
      >
        <HeartIcon filled={active} />
      </span>
    </button>
  );
}
