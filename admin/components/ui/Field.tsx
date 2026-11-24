import { cx } from "./cx";

/** Input styles without a width, for inputs that set their own (e.g. `${inputBase} w-40`). */
export const inputBase =
  "h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-disabled focus:border-focus focus:outline-none";
/** Full-width input (forms and Field). */
export const inputClass = `${inputBase} w-full`;

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-subdued">{hint}</span> : null}
    </label>
  );
}
