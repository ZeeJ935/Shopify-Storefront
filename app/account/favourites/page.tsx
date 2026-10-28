import { redirect } from "next/navigation";
import SiteContainer from "@/app/components/site-container";
import { hasCustomerSession } from "@/lib/customer-account/session";
import FavouritesGrid from "./favourites-grid";

export default async function FavouritesPage() {
  if (!(await hasCustomerSession())) {
    redirect(
      `/account/login?returnTo=${encodeURIComponent("/account/favourites")}`,
    );
  }

  return (
    <main>
      <SiteContainer narrow className="py-10 lg:py-14">
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
      </SiteContainer>
    </main>
  );
}
