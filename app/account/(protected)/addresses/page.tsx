import Link from "next/link";
import { getCustomerAddresses } from "@/lib/customer-account/api";

export const instant = false;

export default async function AccountAddressesPage() {
  let addresses;
  try {
    addresses = await getCustomerAddresses();
  } catch {
    return (
      <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Link
          href="/account"
          className="text-sm font-medium text-steel hover:text-ink hover:underline"
        >
          ← Account
        </Link>
        <h1 className="mt-6 font-display text-3xl font-semibold text-ink">
          Addresses
        </h1>
        <p className="mt-4 text-steel">
          We couldn&apos;t load your addresses. Please try again later.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <Link
        href="/account"
        className="text-sm font-medium text-steel hover:text-ink hover:underline"
      >
        ← Account
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Addresses
      </h1>

      {addresses.length === 0 ? (
        <div className="mt-12 max-w-lg border-y border-mist py-12">
          <h2 className="font-display text-xl font-semibold text-ink">
            No saved addresses
          </h2>
          <p className="mt-3 text-steel">
            Addresses you save with Shopify will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} className="border border-mist p-5">
              <p className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
                {[address.firstName, address.lastName].filter(Boolean).join(" ") ||
                  "Address"}
              </p>
              <div className="mt-3 space-y-1 text-sm text-steel">
                {address.formatted.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
