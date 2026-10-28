import SiteContainer from "./components/site-container";
import Skeleton from "./components/skeleton";

export default function HomeLoading() {
  return (
    <main aria-busy="true" aria-label="Loading storefront">
      <section className="relative isolate min-h-[70vh] overflow-hidden bg-mist">
        <SiteContainer className="relative flex min-h-[70vh] flex-col justify-end py-16 sm:py-20">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-12 w-full max-w-3xl sm:h-14" />
          <Skeleton className="mt-4 h-5 w-full max-w-xl" />
          <Skeleton className="mt-8 h-11 w-40" />
        </SiteContainer>
      </section>

      <section className="py-14 sm:py-20">
        <SiteContainer>
          <div className="mb-10 max-w-2xl space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-5 w-72 max-w-full" />
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="space-y-4">
                <Skeleton className="aspect-[4/5] w-full" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </SiteContainer>
      </section>
    </main>
  );
}
