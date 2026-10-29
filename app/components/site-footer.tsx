import Link from "next/link";
import {
  footerColumns,
  legalLinks,
  paymentMethodsLabel,
  siteBrand,
  socialLinks,
} from "@/lib/site-content";
import type { BrandTile, ResolvedNavLink } from "@/lib/catalog";
import SiteContainer from "./site-container";

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
  const liveSocialLinks = socialLinks.filter((link) => !link.demo);
  const liveLegalLinks = legalLinks.filter((link) => !link.demo);

  return (
    <footer className="mt-auto bg-ink text-snow">
      <SiteContainer className="py-12">
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
              // Demo placeholders point nowhere; drop the flag in site-content once real.
              if (link.demo) return false;
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
          {liveSocialLinks.length > 0 ? (
            <ul className="flex flex-wrap gap-4 text-sm">
              {liveSocialLinks.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.href}
                    className="text-mist hover:text-snow hover:underline"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-snow/10 pt-6 text-xs text-mist sm:flex-row sm:items-center sm:justify-between">
          <p>© {shopName}</p>
          {liveLegalLinks.length > 0 ? (
            <ul className="flex gap-4">
              {liveLegalLinks.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-snow hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SiteContainer>
    </footer>
  );
}
