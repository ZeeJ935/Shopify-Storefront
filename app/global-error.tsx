"use client";

// Replaces the root layout when it fails, so it brings its own document and styles.
import Link from "next/link";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-start justify-center bg-snow px-4 py-20 text-ink sm:px-10">
        <title>Something went wrong · ZJ Store</title>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
          Error
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Something went wrong
        </h1>
        <p className="mt-4 max-w-md text-base text-steel">
          The store couldn&apos;t load. Please try again in a moment.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => retry()} className="btn btn-primary">
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            Go to homepage
          </Link>
        </div>
        {digest ? (
          <p className="mt-6 text-xs text-steel">Reference: {digest}</p>
        ) : null}
      </body>
    </html>
  );
}
