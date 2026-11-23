import { cx } from "./cx";

export const inputClass =
  "h-8 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-disabled focus:border-focus focus:outline-none";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-subdued">{hint}</span> : null}
    </label>
  );
}
