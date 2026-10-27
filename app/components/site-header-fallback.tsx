import Link from "next/link";
import { siteBrand } from "@/lib/site-content";

export default function SiteHeaderFallback() {
  return (
    <header className="sticky top-0 z-50 border-b border-mist bg-snow">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl"
        >
          {siteBrand.name}
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-3">
          <Link
            href="/search"
            className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-ink"
          >
            Search
          </Link>
          <Link
            href="/cart"
            className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-ink"
          >
            Cart
          </Link>
        </nav>
      </div>
    </header>
  );
}
