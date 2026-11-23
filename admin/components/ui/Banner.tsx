import { AlertIcon, CheckIcon, InfoIcon } from "./Icons";
import { cx } from "./cx";

type Tone = "info" | "success" | "warning" | "critical";
const tones: Record<Tone, string> = {
  info: "bg-[var(--info-bg)] text-[var(--info-text)]",
  success: "bg-[var(--success-bg)] text-[var(--success-text)]",
  warning: "bg-[var(--attention-bg)] text-[var(--attention-text)]",
  critical: "bg-[var(--critical-bg)] text-[var(--critical-text)]",
};

export function Banner({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: React.ReactNode }) {
  const Icon = tone === "success" ? CheckIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div role={tone === "critical" || tone === "warning" ? "alert" : "status"} className={cx("flex gap-2 rounded-xl px-3 py-2.5", tones[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-[13px]">{children}</div> : null}
      </div>
    </div>
  );
}
