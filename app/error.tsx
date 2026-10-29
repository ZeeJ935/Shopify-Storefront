"use client";

import Link from "next/link";
import { useEffect } from "react";
import SiteContainer from "@/app/components/site-container";

function errorDigest(error: unknown) {
  return error instanceof Error && "digest" in error
    ? String((error as Error & { digest?: string }).digest ?? "")
    : "";
}

export default function Error({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = errorDigest(error);

  return (
    <main>
      <SiteContainer className="flex min-h-[50vh] flex-col items-start justify-center py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
          Error
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Something went wrong
        </h1>
        <p className="mt-4 max-w-md text-base text-steel">
          We couldn&apos;t load this page. It&apos;s usually temporary, so please
          try again.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => retry()} className="btn btn-primary">
            Try again
          </button>
          <Link href="/collections/all" className="btn btn-secondary">
            Continue shopping
          </Link>
        </div>
        {digest ? (
          <p className="mt-6 text-xs text-steel">Reference: {digest}</p>
        ) : null}
      </SiteContainer>
    </main>
  );
}
