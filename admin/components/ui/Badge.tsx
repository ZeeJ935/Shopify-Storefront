import { cx } from "./cx";

export type Tone = "success" | "attention" | "warning" | "critical" | "info" | "neutral";

const tones: Record<Tone, string> = {
  success: "bg-[var(--success-bg)] text-[var(--success-text)]",
  attention: "bg-[var(--attention-bg)] text-[var(--attention-text)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  critical: "bg-[var(--critical-bg)] text-[var(--critical-text)]",
  info: "bg-[var(--info-bg)] text-[var(--info-text)]",
  neutral: "bg-[var(--neutral-bg)] text-[var(--neutral-text)]",
};

/** Status pill. `dot` adds the progress dot Shopify uses for fulfillment/payment states. */
export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: React.ReactNode; dot?: "full" | "partial" | "empty" }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>
      {dot ? (
        <span
          className={cx(
            "size-2 rounded-full border-[1.5px] border-current",
            dot === "full" && "bg-current",
            dot === "partial" && "bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
