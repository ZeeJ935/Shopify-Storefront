import Link from "next/link";
import SiteContainer from "@/app/components/site-container";

export default function NotFound() {
  return (
    <main>
      <SiteContainer className="flex min-h-[50vh] flex-col items-start justify-center py-20">
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
      </SiteContainer>
    </main>
  );
}
