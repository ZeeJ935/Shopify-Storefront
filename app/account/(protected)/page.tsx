import Link from "next/link";
import { getCustomerProfile } from "@/lib/customer-account/api";

export const instant = false;

export default async function AccountPage() {
  let profile;
  try {
    profile = await getCustomerProfile();
  } catch {
    return (
      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold text-ink">
          My Account
        </h1>
        <p className="mt-4 text-steel">
          We couldn&apos;t load your account right now. Please try again.
        </p>
        <Link href="/account/logout" className="btn btn-secondary mt-8">
          Sign out
        </Link>
      </main>
    );
  }

  const name = profile.firstName || profile.displayName || "there";

  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="border-b border-mist pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
          Account
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          My Account
        </h1>
        <p className="mt-3 text-base text-steel">Welcome back, {name}.</p>
        {profile.email ? (
          <p className="mt-1 text-sm text-steel">{profile.email}</p>
        ) : null}
      </div>

      <ul className="mt-10 divide-y divide-mist border-y border-mist">
        <li>
          <Link
            href="/account/orders"
            className="flex items-center justify-between gap-4 py-6 transition-colors hover:bg-mist/30"
          >
            <div>
              <p className="font-display text-base font-semibold uppercase tracking-wide text-ink">
                Orders
              </p>
              <p className="mt-1 text-sm text-steel">
                View and track your purchases
              </p>
            </div>
            <span aria-hidden="true" className="text-steel">
              →
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/account/addresses"
            className="flex items-center justify-between gap-4 py-6 transition-colors hover:bg-mist/30"
          >
            <div>
              <p className="font-display text-base font-semibold uppercase tracking-wide text-ink">
                Addresses
              </p>
              <p className="mt-1 text-sm text-steel">
                Manage your saved addresses
              </p>
            </div>
            <span aria-hidden="true" className="text-steel">
              →
            </span>
          </Link>
        </li>
        <li>
          <div className="py-6">
            <p className="font-display text-base font-semibold uppercase tracking-wide text-ink">
              Profile
            </p>
            <p className="mt-1 text-sm text-steel">
              {[profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
                profile.displayName}
              {profile.email ? ` · ${profile.email}` : ""}
            </p>
          </div>
        </li>
      </ul>

      <Link
        href="/account/logout"
        className="mt-10 inline-flex min-h-11 items-center text-sm font-medium uppercase tracking-wide text-steel underline-offset-4 hover:text-ink hover:underline"
      >
        Sign out
      </Link>
    </main>
  );
}
