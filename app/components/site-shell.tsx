import { Suspense } from "react";
import { getNavCatalog } from "@/lib/catalog";
import { announcementMessages, siteBrand } from "@/lib/site-content";
import AnnouncementBar from "./announcement-bar";
import FavoritesRoot from "./favorites-root";
import SiteFooter from "./site-footer";
import SiteHeader from "./site-header";
import SiteHeaderFallback from "./site-header-fallback";

async function SiteFooterFromCatalog() {
  const catalog = await getNavCatalog();

  return (
    <SiteFooter
      shopName={siteBrand.name}
      navLinks={catalog.links}
      brandTiles={catalog.brandTiles}
    />
  );
}

/**
 * Root chrome must stay prerenderable for `/_not-found`.
 * Request/cookie data (header cart) and catalog fetches stay inside Suspense.
 */
export default function SiteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FavoritesRoot>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-snow focus:px-4 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>
      <AnnouncementBar messages={announcementMessages} />
      <Suspense fallback={<SiteHeaderFallback />}>
        <SiteHeader />
      </Suspense>
      <div id="main-content" className="flex-1">
        {children}
      </div>
      <Suspense fallback={<SiteFooter shopName={siteBrand.name} />}>
        <SiteFooterFromCatalog />
      </Suspense>
    </FavoritesRoot>
  );
}
