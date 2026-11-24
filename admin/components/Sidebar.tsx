"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuditIcon, CloseIcon, HomeIcon, InventoryIcon, MenuIcon, OrdersIcon, WarehouseIcon } from "./ui/Icons";
import { cx } from "./ui/cx";

const ICONS = { "/": HomeIcon, "/orders": OrdersIcon, "/inventory": InventoryIcon, "/warehouse": WarehouseIcon, "/audit": AuditIcon } as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Left navigation; a slide-in drawer below the lg breakpoint. */
export function Sidebar({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  // Close the drawer after navigating.
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {[{ href: "/", label: "Home" }, ...items].map((item) => {
        const Icon = ICONS[item.href as keyof typeof ICONS] ?? HomeIcon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 font-semibold text-fg no-underline",
              active ? "bg-nav-active shadow-card" : "hover:bg-nav-hover",
            )}
          >
            <Icon className={cx("size-5", active ? "text-fg" : "text-subdued")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed top-2.5 left-2 z-40 rounded-lg p-1.5 text-topbar-fg hover:bg-white/10 lg:hidden"
      >
        <MenuIcon />
      </button>
      <aside className="fixed top-14 bottom-0 left-0 hidden w-60 overflow-y-auto bg-nav lg:block">{nav}</aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute top-0 bottom-0 left-0 w-64 bg-nav shadow-xl">
            <div className="flex h-14 items-center justify-between px-3">
              <span className="font-bold">ZJ Admin</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded-lg p-1.5 hover:bg-nav-hover">
                <CloseIcon />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
