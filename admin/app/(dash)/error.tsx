"use client";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Banner tone="critical" title="Something went wrong loading this page">
        The backend may be waking up or unavailable. Nothing was changed.
      </Banner>
      <div className="mt-4">
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
