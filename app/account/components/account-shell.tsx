"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "@/app/components/logout-button";
import SiteContainer from "@/app/components/site-container";
import { ToastProvider } from "./toast";

const NAV = [
  { href: "/account", label: "Overview", match: (p: string) => p === "/account" },
  {
    href: "/account/orders",
    label: "Orders",
    match: (p: string) => p.startsWith("/account/orders"),
  },
  {
    href: "/account/addresses",
    label: "Addresses",
    match: (p: string) => p.startsWith("/account/addresses"),
  },
  {
    href: "/account/profile",
    label: "Profile",
    match: (p: string) => p.startsWith("/account/profile"),
  },
] as const;

type AccountShellProps = {
  firstName: string | null;
  displayName: string;
  email: string | null;
  children: React.ReactNode;
};

function initials(firstName: string | null, displayName: string) {
  const source = (firstName || displayName || "A").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function AccountShell({
  firstName,
  displayName,
  email,
  children,
}: AccountShellProps) {
  const pathname = usePathname();
  const welcomeName = firstName || displayName.split(" ")[0] || "there";

  return (
    <ToastProvider>
      <SiteContainer narrow className="py-10 lg:py-14">
        <header className="mb-8 flex flex-col gap-4 border-b border-mist pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg font-semibold text-snow"
              aria-hidden="true"
            >
              {initials(firstName, displayName)}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
                Account
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Welcome back, {welcomeName}
              </h1>
              {email ? (
                <p className="mt-1 text-sm text-steel">{email}</p>
              ) : null}
            </div>
          </div>
          <LogoutButton className="btn btn-secondary w-full sm:w-auto">
            Sign out
          </LogoutButton>
        </header>

        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <nav
            aria-label="Account"
            className="mb-6 flex gap-1 overflow-x-auto border-b border-mist pb-px lg:mb-0 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0"
          >
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors lg:block ${
                    active
                      ? "bg-ink text-snow"
                      : "text-steel hover:bg-mist/60 hover:text-ink"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="min-w-0">{children}</div>
        </div>
      </SiteContainer>
    </ToastProvider>
  );
}
