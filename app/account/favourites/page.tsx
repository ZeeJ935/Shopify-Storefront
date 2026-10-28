import { redirect } from "next/navigation";
import { hasCustomerSession } from "@/lib/customer-account/session";
import FavouritesGrid from "./favourites-grid";

export default async function FavouritesPage() {
  if (!(await hasCustomerSession())) {
    redirect(
      `/account/login?returnTo=${encodeURIComponent("/account/favourites")}`,
    );
  }

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <header className="mb-8 border-b border-mist pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
          Saved
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Favourites
        </h1>
        <p className="mt-2 text-sm text-steel">
          Products you&apos;ve saved for later — synced to your account.
        </p>
      </header>
      <FavouritesGrid />
    </main>
  );
}
