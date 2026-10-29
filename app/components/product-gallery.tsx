"use client";

import Image from "next/image";
import { useState } from "react";
import type { ShopifyImage } from "@/lib/products";

const VISIBLE_THUMBS = 4;

type ProductGalleryProps = {
  images: ShopifyImage[];
  productTitle: string;
};

export default function ProductGallery({
  images,
  productTitle,
}: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [thumbStart, setThumbStart] = useState(0);
  const active = images[activeIndex] ?? null;
  const showArrows = images.length > VISIBLE_THUMBS;
  const maxStart = Math.max(0, images.length - VISIBLE_THUMBS);
  // Thumbnails are only clickable while visible, so the active one never needs
  // scrolling into view; the arrows move the strip freely.
  const visibleImages = images.slice(thumbStart, thumbStart + VISIBLE_THUMBS);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center bg-mist text-sm text-steel">
        <span>No image available</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/5] overflow-hidden bg-mist">
        {active && (
          <Image
            src={active.url}
            alt={active.altText ?? productTitle}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        )}
      </div>

      {images.length > 1 && (
        <div className="relative flex items-center gap-2">
          {showArrows && (
            <button
              type="button"
              aria-label="Previous images"
              disabled={thumbStart <= 0}
              onClick={() => setThumbStart((s) => Math.max(0, s - 1))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-mist bg-snow text-ink disabled:pointer-events-none disabled:opacity-30"
            >
              <Chevron direction="left" />
            </button>
          )}

          <ul
            className="grid min-w-0 flex-1 grid-cols-4 gap-2"
            aria-label="Product images"
          >
            {visibleImages.map((image, offset) => {
              const index = thumbStart + offset;
              const selected = index === activeIndex;
              return (
                <li key={`${image.url}-${index}`} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Show image ${index + 1} of ${images.length}`}
                    aria-current={selected ? "true" : undefined}
                    className={`relative aspect-square w-full overflow-hidden border ${
                      selected ? "border-ink" : "border-mist"
                    }`}
                  >
                    <Image
                      src={image.url}
                      alt=""
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                    <span className="sr-only">
                      {selected ? "Selected" : "Not selected"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {showArrows && (
            <button
              type="button"
              aria-label="Next images"
              disabled={thumbStart >= maxStart}
              onClick={() => setThumbStart((s) => Math.min(maxStart, s + 1))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-mist bg-snow text-ink disabled:pointer-events-none disabled:opacity-30"
            >
              <Chevron direction="right" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      {direction === "left" ? (
        <path
          fillRule="evenodd"
          d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
          clipRule="evenodd"
        />
      ) : (
        <path
          fillRule="evenodd"
          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}
