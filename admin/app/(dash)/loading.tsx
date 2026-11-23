/** Skeleton while a dashboard page loads. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse px-4 py-5 sm:px-6" aria-busy="true" aria-label="Loading">
      <div className="mb-5 h-6 w-40 rounded-md bg-surface-selected" />
      <div className="rounded-xl bg-surface p-4 shadow-card">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mb-3 h-4 rounded bg-surface-selected last:mb-0" />
        ))}
      </div>
    </div>
  );
}
