"use client";

import Link from "next/link";
import { useEffect } from "react";
import SiteContainer from "@/app/components/site-container";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Shown when a catalog page can't load its products (for example the catalog
 * service is down or waking up). Says so plainly instead of showing an empty
 * catalog, and lets the shopper try again.
 */
export default function CollectionsError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "collections");
  }, [error]);

  return (
    <main>
      <SiteContainer className="flex min-h-[50vh] flex-col items-start justify-center py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
          Products
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          We couldn&apos;t load products right now
        </h1>
        <p className="mt-4 max-w-md text-base text-steel">
          This is usually temporary. Please try again in a moment.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => retry()} className="btn btn-primary">
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            Back to home
          </Link>
        </div>
      </SiteContainer>
    </main>
  );
}
