export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
      <div className="mb-1 size-12 rounded-full bg-surface-subdued" aria-hidden="true" />
      <p className="text-sm font-semibold">{title}</p>
      {children ? <p className="text-subdued">{children}</p> : null}
      {action}
    </div>
  );
}
