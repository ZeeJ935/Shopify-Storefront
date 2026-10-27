import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-7xl flex-col items-start justify-center px-4 py-20 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">
        404
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-base text-steel">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link href="/collections/all" className="btn btn-primary mt-8">
        Continue shopping
      </Link>
    </main>
  );
}
