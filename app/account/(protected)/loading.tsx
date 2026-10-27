import Skeleton from "@/app/components/skeleton";

export default function AccountLoading() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-56" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <Skeleton className="hidden h-40 lg:block" />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
