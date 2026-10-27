import Image from "next/image";
import Link from "next/link";
import { getCollectionsIndex } from "@/lib/collections";

export const instant = false;

export const metadata = {
  title: "Collections",
  description: "Browse ZJ Store collections.",
};

export default async function CollectionsIndexPage() {
  let collections: Awaited<ReturnType<typeof getCollectionsIndex>> = [];
  try {
    collections = await getCollectionsIndex();
  } catch {
    collections = [];
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="display-section text-ink">Collections</h1>
      <p className="mt-3 max-w-xl text-steel">
        Shop by category, brand, and seasonal edits from the live catalog.
      </p>
      <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <Link
            href="/collections/all"
            className="group flex min-h-40 flex-col justify-end border border-mist bg-white p-6 hover:border-ink"
          >
            <span className="font-display text-xl font-bold uppercase tracking-wide">
              All products
            </span>
            <span className="mt-1 text-sm text-steel">Full catalog</span>
          </Link>
        </li>
        {collections.map((c) => (
          <li key={c.handle}>
            <Link
              href={`/collections/${c.handle}`}
              className="group relative flex min-h-40 flex-col justify-end overflow-hidden bg-mist p-6"
            >
              {c.image && (
                <Image
                  src={c.image.url}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover opacity-70 transition group-hover:scale-[1.03]"
                  aria-hidden="true"
                />
              )}
              <div className="absolute inset-0 bg-ink/30" />
              <span className="relative font-display text-xl font-bold uppercase tracking-wide text-snow">
                {c.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
