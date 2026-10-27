import Skeleton from "@/app/components/skeleton";

export default function CollectionsLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label="Loading collection"
    >
      <Skeleton className="h-10 w-64 skeleton-shimmer" />
      <Skeleton className="mt-4 h-4 w-96 max-w-full skeleton-shimmer" />
      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="aspect-[4/5] w-full skeleton-shimmer" />
            <Skeleton className="mt-3 h-4 w-3/4 skeleton-shimmer" />
            <Skeleton className="mt-2 h-4 w-1/2 skeleton-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
