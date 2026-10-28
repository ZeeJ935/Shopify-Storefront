import SiteContainer from "@/app/components/site-container";
import Skeleton from "@/app/components/skeleton";

export default function CartLoading() {
  return (
    <main aria-busy="true" aria-label="Loading cart">
      <SiteContainer boxed className="py-10 sm:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-5 w-36" />
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:items-start lg:gap-12">
          <ul className="divide-y divide-mist border-y border-mist">
            {Array.from({ length: 3 }).map((_, index) => (
              <li
                key={index}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 py-6 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:gap-6"
              >
                <Skeleton className="aspect-square w-full rounded" />
                <div className="min-w-0 space-y-3">
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-11 w-40" />
                </div>
                <Skeleton className="col-span-2 h-5 w-16 justify-self-end sm:col-span-1" />
              </li>
            ))}
          </ul>

          <aside className="rounded border border-mist bg-white p-5">
            <Skeleton className="h-6 w-36" />
            <div className="mt-5 space-y-3">
              <div className="flex justify-between gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between gap-4 border-t border-mist pt-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
            <div className="mt-5 space-y-3 border-t border-mist pt-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-11 w-full" />
            </div>
            <Skeleton className="mt-6 h-11 w-full" />
          </aside>
        </div>
      </SiteContainer>
    </main>
  );
}