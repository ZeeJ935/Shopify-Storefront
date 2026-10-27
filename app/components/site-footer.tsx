import Link from "next/link";
import {
  footerColumns,
  legalLinks,
  paymentMethodsLabel,
  siteBrand,
  socialLinks,
} from "@/lib/site-content";
import type { BrandTile, ResolvedNavLink } from "@/lib/catalog";

type SiteFooterProps = {
  shopName?: string;
  navLinks?: ResolvedNavLink[];
  brandTiles?: BrandTile[];
};

export default function SiteFooter({
  shopName = siteBrand.name,
  navLinks = [],
  brandTiles = [],
}: SiteFooterProps) {
  return (
    <footer className="mt-auto bg-ink text-snow">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <p className="font-display text-xl font-bold">{shopName}</p>
            <p className="mt-3 max-w-xs text-sm text-mist">{siteBrand.tagline}</p>
          </div>

          {footerColumns.map((column) => {
            if (column.title === "Brands") {
              return (
                <div key={column.title}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-mist">
                    Brands
                  </p>
                  <ul className="mt-4 space-y-2">
                    {brandTiles.map((b) => (
                      <li key={b.label}>
                        <Link
                          href={b.href}
                          className="inline-flex min-h-11 items-center text-sm text-snow/90 hover:underline"
                        >
                          {b.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }

            const links = column.links.filter((link) => {
              if (link.demo && link.href === "/#") return true;
              if (column.title === "Shop") {
                if (link.href === "/cart" || link.href === "/collections/all") {
                  return true;
                }
                if (link.href.startsWith("/collections/")) {
                  const handle = link.href.replace("/collections/", "");
                  return navLinks.some(
                    (l) =>
                      l.href === link.href ||
                      l.collectionHandle === handle,
                  );
                }
              }
              return true;
            });
            if (links.length === 0) return null;

            return (
              <div key={column.title}>
                <p className="text-xs font-semibold uppercase tracking-wider text-mist">
                  {column.title}
                </p>
                <ul className="mt-4 space-y-2">
                  {links.map((link) => (
                    <li key={`${column.title}-${link.label}`}>
                      <Link
                        href={link.href}
                        className="inline-flex min-h-11 items-center text-sm text-snow/90 hover:underline"
                      >
                        {link.label}
                        {link.demo ? (
                          <span className="sr-only"> (demo)</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-12 flex flex-col gap-6 border-t border-snow/15 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-mist">{paymentMethodsLabel}</p>
          <ul className="flex flex-wrap gap-4 text-sm">
            {socialLinks.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  className="text-mist hover:text-snow hover:underline"
                  aria-label={`${s.label} (demo placeholder)`}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-snow/10 pt-6 text-xs text-mist sm:flex-row sm:items-center sm:justify-between">
          <p>© {shopName}</p>
          <ul className="flex gap-4">
            {legalLinks.map((l) => (
              <li key={l.label}>
                <Link href={l.href} className="hover:text-snow hover:underline">
                  {l.label}
                  {l.demo ? <span className="sr-only"> (demo)</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
