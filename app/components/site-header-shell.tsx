"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  BrandTile,
  ProductTypeTile,
  ResolvedNavLink,
} from "@/lib/catalog";
import { siteBrand } from "@/lib/site-content";
import SearchDrawer from "./search-drawer";

type SiteHeaderShellProps = {
  links: ResolvedNavLink[];
  brandTiles: BrandTile[];
  productTypeTiles: ProductTypeTile[];
  hasTrending: boolean;
  hasSale: boolean;
  cartQuantity: number;
  shopName?: string;
  isAuthenticated?: boolean;
};

function CartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="9" cy="20" r="1.25" />
      <circle cx="17" cy="20" r="1.25" />
      <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <span className="text-lg leading-none" aria-hidden="true">
      ×
    </span>
  ) : (
    <span className="flex flex-col gap-1.5" aria-hidden="true">
      <span className="block h-0.5 w-5 bg-current" />
      <span className="block h-0.5 w-5 bg-current" />
      <span className="block h-0.5 w-5 bg-current" />
    </span>
  );
}

const OPEN_DELAY = 120;
const CLOSE_DELAY = 180;

export default function SiteHeaderShell({
  links,
  brandTiles,
  productTypeTiles,
  hasTrending,
  hasSale,
  cartQuantity,
  shopName = siteBrand.name,
  isAuthenticated = false,
}: SiteHeaderShellProps) {
  const [scrolled, setScrolled] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accordionId, setAccordionId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const megaId = useId();
  const drawerId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const scheduleOpen = useCallback(
    (id: string) => {
      clearTimers();
      openTimer.current = window.setTimeout(() => setOpenMenuId(id), OPEN_DELAY);
    },
    [clearTimers],
  );

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(
      () => setOpenMenuId(null),
      CLOSE_DELAY,
    );
  }, [clearTimers]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenMenuId(null);
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-scroll-locked", mobileOpen);
    return () => document.body.classList.remove("is-scroll-locked");
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen || !drawerRef.current) return;
    const root = drawerRef.current;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab" || focusables.length === 0) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    const menuButton = menuButtonRef.current;
    root.addEventListener("keydown", trap);
    return () => {
      root.removeEventListener("keydown", trap);
      menuButton?.focus();
    };
  }, [mobileOpen]);

  const cartLabel =
    cartQuantity > 0
      ? `View cart, ${cartQuantity} item${cartQuantity === 1 ? "" : "s"}`
      : "View cart";

  const megaLinks = links.filter((l) => l.megaMenu);
  const activeMega = megaLinks.find((l) => l.id === openMenuId) ?? null;

  function onNavKeyDown(e: ReactKeyboardEvent, link: ResolvedNavLink) {
    if (!link.megaMenu) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpenMenuId(link.id);
    }
  }

  return (
    <>
      <header
        className={`sticky top-0 z-50 border-b border-white/50 bg-snow/55 shadow-[0_1px_0_rgba(11,18,32,0.04)] backdrop-blur-xl backdrop-saturate-150 transition-[background-color,box-shadow] supports-[backdrop-filter]:bg-snow/40 ${
          scrolled ? "bg-snow/70 shadow-sm supports-[backdrop-filter]:bg-snow/55" : ""
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button
            ref={menuButtonRef}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls={drawerId}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((o) => !o)}
          >
            <MenuIcon open={mobileOpen} />
          </button>

          <Link
            href="/"
            className="font-display shrink-0 text-lg font-bold tracking-tight text-ink sm:text-xl"
          >
            {shopName}
          </Link>

          <nav
            aria-label="Primary"
            className="ml-4 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex"
            onMouseLeave={scheduleClose}
          >
            {links.map((link) => (
              <div
                key={link.id}
                className="relative"
                onMouseEnter={() =>
                  link.megaMenu ? scheduleOpen(link.id) : scheduleClose()
                }
              >
                <Link
                  href={link.href}
                  className={`inline-flex min-h-11 items-center px-3 text-sm font-semibold uppercase tracking-wide text-ink hover:underline ${
                    openMenuId === link.id ? "underline" : ""
                  }`}
                  aria-expanded={
                    link.megaMenu ? openMenuId === link.id : undefined
                  }
                  aria-haspopup={link.megaMenu ? "true" : undefined}
                  aria-controls={
                    link.megaMenu ? `${megaId}-${link.id}` : undefined
                  }
                  onFocus={() =>
                    link.megaMenu ? setOpenMenuId(link.id) : setOpenMenuId(null)
                  }
                  onKeyDown={(e) => onNavKeyDown(e, link)}
                >
                  {link.label}
                </Link>
              </div>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center text-ink hover:bg-mist/60"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon />
            </button>
            <div
              className="relative hidden sm:block"
              onMouseEnter={() => setAccountOpen(true)}
              onMouseLeave={() => setAccountOpen(false)}
            >
              <Link
                href={isAuthenticated ? "/account" : "/account/login"}
                className="inline-flex h-11 items-center px-3 text-sm font-medium uppercase tracking-wide text-ink hover:bg-mist/60"
                aria-expanded={accountOpen}
                onFocus={() => setAccountOpen(true)}
              >
                Account
              </Link>
              {accountOpen ? (
                <div className="absolute right-0 top-full z-50 min-w-[11rem] border border-mist bg-snow py-2 shadow-sm">
                  {isAuthenticated ? (
                    <>
                      <Link
                        href="/account"
                        className="block px-4 py-2 text-sm text-ink hover:bg-mist/50"
                      >
                        Account
                      </Link>
                      <Link
                        href="/account/orders"
                        className="block px-4 py-2 text-sm text-ink hover:bg-mist/50"
                      >
                        Orders
                      </Link>
                      <Link
                        href="/account/logout"
                        className="block px-4 py-2 text-sm text-ink hover:bg-mist/50"
                      >
                        Log out
                      </Link>
                    </>
                  ) : (
                    <Link
                      href="/account/login"
                      className="block px-4 py-2 text-sm text-ink hover:bg-mist/50"
                    >
                      Log in / Sign up
                    </Link>
                  )}
                </div>
              ) : null}
            </div>
            <Link
              href="/cart"
              className="relative inline-flex h-11 min-w-11 items-center justify-center gap-2 px-2 text-sm font-medium text-ink hover:bg-mist/60"
              aria-label={cartLabel}
            >
              <CartIcon />
              <span className="hidden sm:inline">Cart</span>
              {cartQuantity > 0 && (
                <span
                  className="absolute right-0.5 top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-semibold text-snow sm:static"
                  aria-hidden="true"
                >
                  {cartQuantity > 99 ? "99+" : cartQuantity}
                </span>
              )}
            </Link>
          </div>
        </div>

        {activeMega && (
          <div
            id={`${megaId}-${activeMega.id}`}
            role="region"
            aria-label={`${activeMega.label} menu`}
            className="absolute inset-x-0 top-full z-50 hidden border-b border-white/40 bg-snow/75 shadow-md backdrop-blur-xl supports-[backdrop-filter]:bg-snow/60 lg:block"
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
          >
            {activeMega.id === "catalog" ? (
              <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Shop by Category
                  </p>
                  <ul className="mt-4 space-y-1">
                    {productTypeTiles.map((t) => (
                      <li key={t.productType}>
                        <Link
                          href={t.href}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          {t.productType}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Shop by Brand
                  </p>
                  <ul className="mt-4 space-y-1">
                    {brandTiles.map((b) => (
                      <li key={b.label}>
                        <Link
                          href={b.href}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          {b.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Shop by Gender
                  </p>
                  <ul className="mt-4 space-y-1">
                    {[
                      { label: "Men", href: "/collections/men" },
                      { label: "Women", href: "/collections/women" },
                      { label: "Kids", href: "/collections/kids" },
                      {
                        label: "Unisex",
                        href: "/collections/all?gender=Unisex",
                      },
                    ].map((g) => (
                      <li key={g.label}>
                        <Link
                          href={g.href}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          {g.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Quick links
                  </p>
                  <ul className="mt-4 space-y-1">
                    <li>
                      <Link
                        href="/collections/all?sort=latest"
                        className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                        onClick={() => setOpenMenuId(null)}
                      >
                        New arrivals
                      </Link>
                    </li>
                    {hasSale && (
                      <li>
                        <Link
                          href="/collections/sale"
                          className="inline-flex min-h-11 items-center text-sm font-medium text-sale hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          Sale
                        </Link>
                      </li>
                    )}
                    {hasTrending && (
                      <li>
                        <Link
                          href="/collections/trending"
                          className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          Trending
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 lg:grid-cols-12 lg:px-8">
                <div className="lg:col-span-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Shop {activeMega.label}
                  </p>
                  <ul className="mt-4 space-y-1">
                    <li>
                      <Link
                        href={activeMega.href}
                        className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                        onClick={() => setOpenMenuId(null)}
                      >
                        All {activeMega.label}
                      </Link>
                    </li>
                    {activeMega.productType && (
                      <li>
                        <Link
                          href={`/collections/all?type=${encodeURIComponent(activeMega.productType)}`}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          {activeMega.productType}
                        </Link>
                      </li>
                    )}
                    {hasSale && (
                      <li>
                        <Link
                          href="/collections/sale"
                          className="inline-flex min-h-11 items-center text-sm font-medium text-sale hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          Sale
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
                <div className="lg:col-span-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel">
                    Brands
                  </p>
                  <ul className="mt-4 space-y-1">
                    {brandTiles.map((b) => (
                      <li key={b.label}>
                        <Link
                          href={b.href}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-ink hover:underline"
                          onClick={() => setOpenMenuId(null)}
                        >
                          {b.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:col-span-5">
                  {activeMega.featuredProducts.map((product) => (
                    <Link
                      key={product.handle}
                      href={`/products/${product.handle}`}
                      className="group relative block aspect-[4/5] overflow-hidden bg-mist focus-visible:outline-offset-4"
                      onClick={() => setOpenMenuId(null)}
                    >
                      {product.featuredImage ? (
                        <Image
                          src={product.featuredImage.url}
                          alt={product.featuredImage.altText ?? product.title}
                          fill
                          sizes="(max-width: 1024px) 40vw, 20vw"
                          className="object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                      ) : null}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-3 text-sm font-semibold text-snow">
                        {product.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <SearchDrawer open={searchOpen} onClose={() => setSearchOpen(false)} />

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[60] lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
          id={drawerId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col bg-snow shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-mist px-4 py-3">
              <p className="font-display text-lg font-bold">{shopName}</p>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center text-2xl"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                ×
              </button>
            </div>
            <form action="/search" className="border-b border-mist p-4">
              <label htmlFor="mobile-search" className="sr-only">
                Search
              </label>
              <input
                id="mobile-search"
                name="q"
                type="search"
                placeholder="Search products"
                className="field"
              />
            </form>
            <nav
              aria-label="Mobile"
              className="flex-1 overflow-y-auto px-2 py-2"
            >
              {links.map((link) => (
                <div key={link.id} className="border-b border-mist/80">
                  {link.megaMenu ? (
                    <>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm font-semibold uppercase tracking-wide"
                        aria-expanded={accordionId === link.id}
                        onClick={() =>
                          setAccordionId((id) =>
                            id === link.id ? null : link.id,
                          )
                        }
                      >
                        {link.label}
                        <span aria-hidden="true">
                          {accordionId === link.id ? "−" : "+"}
                        </span>
                      </button>
                      {accordionId === link.id && (
                        <ul className="pb-2 pl-3">
                          {link.id === "catalog" ? (
                            <>
                              {productTypeTiles.map((t) => (
                                <li key={t.productType}>
                                  <Link
                                    href={t.href}
                                    className="flex min-h-11 items-center px-3 text-sm"
                                    onClick={() => setMobileOpen(false)}
                                  >
                                    {t.productType}
                                  </Link>
                                </li>
                              ))}
                              {brandTiles.map((b) => (
                                <li key={b.label}>
                                  <Link
                                    href={b.href}
                                    className="flex min-h-11 items-center px-3 text-sm"
                                    onClick={() => setMobileOpen(false)}
                                  >
                                    {b.label}
                                  </Link>
                                </li>
                              ))}
                              <li>
                                <Link
                                  href="/collections/all?sort=latest"
                                  className="flex min-h-11 items-center px-3 text-sm"
                                  onClick={() => setMobileOpen(false)}
                                >
                                  New arrivals
                                </Link>
                              </li>
                            </>
                          ) : (
                            <>
                              <li>
                                <Link
                                  href={link.href}
                                  className="flex min-h-11 items-center px-3 text-sm"
                                  onClick={() => setMobileOpen(false)}
                                >
                                  All {link.label}
                                </Link>
                              </li>
                              {brandTiles.map((b) => (
                                <li key={`m-${link.id}-${b.label}`}>
                                  <Link
                                    href={b.href}
                                    className="flex min-h-11 items-center px-3 text-sm"
                                    onClick={() => setMobileOpen(false)}
                                  >
                                    {b.label}
                                  </Link>
                                </li>
                              ))}
                            </>
                          )}
                          {hasSale && (
                            <li>
                              <Link
                                href="/collections/sale"
                                className="flex min-h-11 items-center px-3 text-sm text-sale"
                                onClick={() => setMobileOpen(false)}
                              >
                                Sale
                              </Link>
                            </li>
                          )}
                        </ul>
                      )}
                    </>
                  ) : (
                    <Link
                      href={link.href}
                      className="flex min-h-11 items-center px-3 text-sm font-semibold uppercase tracking-wide"
                      onClick={() => setMobileOpen(false)}
                    >
                      {link.label}
                    </Link>
                  )}
                </div>
              ))}
            </nav>
            <div className="space-y-2 border-t border-mist p-4">
              {isAuthenticated ? (
                <>
                  <Link
                    href="/account"
                    className="flex min-h-11 items-center px-1 text-sm font-semibold uppercase tracking-wide"
                    onClick={() => setMobileOpen(false)}
                  >
                    Account
                  </Link>
                  <Link
                    href="/account/orders"
                    className="flex min-h-11 items-center px-1 text-sm font-semibold uppercase tracking-wide"
                    onClick={() => setMobileOpen(false)}
                  >
                    Orders
                  </Link>
                  <Link
                    href="/account/logout"
                    className="flex min-h-11 items-center px-1 text-sm font-semibold uppercase tracking-wide"
                    onClick={() => setMobileOpen(false)}
                  >
                    Log out
                  </Link>
                </>
              ) : (
                <Link
                  href="/account/login"
                  className="flex min-h-11 items-center px-1 text-sm font-semibold uppercase tracking-wide"
                  onClick={() => setMobileOpen(false)}
                >
                  Account
                </Link>
              )}
              <Link
                href="/cart"
                className="btn btn-primary w-full"
                onClick={() => setMobileOpen(false)}
              >
                Cart{cartQuantity > 0 ? ` (${cartQuantity})` : ""}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
