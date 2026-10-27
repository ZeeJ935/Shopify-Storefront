import Skeleton from "@/app/components/skeleton";

export default function ProductLoading() {
  return (
    <main
      className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14"
      aria-busy="true"
      aria-label="Loading product"
    >
      <Skeleton className="mb-8 h-5 w-36" />

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="space-y-3">
          <Skeleton className="aspect-[4/5] w-full" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="aspect-square w-full" />
            ))}
          </div>
        </div>

        <section className="space-y-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-7 w-28" />
          <div className="space-y-2 pt-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-32" />
          </div>
          <Skeleton className="h-11 w-full sm:w-44" />
          <div className="space-y-3 border-t border-mist pt-8">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </section>
      </div>
    </main>
  );
}
