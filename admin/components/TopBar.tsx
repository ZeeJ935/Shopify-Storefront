import Link from "next/link";
import { roleLabel } from "@/lib/badges";
import type { StaffIdentity } from "@/lib/session";
import { LogoutIcon, SearchIcon } from "./ui/Icons";

/** Dark top bar: brand, search (orders and SKUs), and the staff menu. */
export function TopBar({ staff }: { staff: StaffIdentity }) {
  const initials = staff.email.slice(0, 2).toUpperCase();
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 bg-topbar px-3 text-topbar-fg lg:px-4">
      <Link href="/" className="ml-9 flex items-center gap-2 font-bold whitespace-nowrap text-white no-underline lg:ml-0 lg:w-56">
        <span className="grid size-7 place-items-center rounded-md bg-white text-xs font-black text-[#1a1a1a]">ZJ</span>
        <span className="hidden sm:inline">ZJ Admin</span>
      </Link>
      <form action="/search" role="search" className="mx-auto w-full max-w-xl">
        <label className="flex h-8 items-center gap-2 rounded-lg bg-topbar-field px-2.5 text-[#b5b5b5] focus-within:ring-2 focus-within:ring-focus">
          <SearchIcon className="size-4 shrink-0" />
          <span className="sr-only">Search</span>
          <input name="q" placeholder="Search orders or SKUs" className="w-full bg-transparent text-[13px] text-white placeholder:text-[#8a8a8a] focus:outline-none" />
        </label>
      </form>
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/10">
          <span className="grid size-7 place-items-center rounded-md bg-[#35c06c] text-xs font-bold text-[#0c3a1f]">{initials}</span>
          <span className="hidden max-w-48 truncate md:inline">{staff.email}</span>
        </summary>
        <div className="absolute right-0 mt-2 w-64 rounded-xl bg-surface p-2 text-fg shadow-xl ring-1 ring-black/5">
          <div className="px-2 py-1.5">
            <p className="truncate font-semibold">{staff.email}</p>
            <p className="text-subdued">{roleLabel(staff.role)}</p>
          </div>
          <form method="post" action="/logout" className="border-t border-line pt-1">
            <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover">
              <LogoutIcon className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </details>
    </header>
  );
}
