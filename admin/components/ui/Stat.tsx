import Link from "next/link";
import { cx } from "./cx";

/** Summary tile for the home page. */
export function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: "critical" | "attention" }) {
  const body = (
    <>
      <p className="text-subdued">{label}</p>
      <p className={cx("mt-1 text-2xl font-bold tabular-nums", tone === "critical" && "text-critical", tone === "attention" && "text-[var(--attention-text)]")}>{value}</p>
    </>
  );
  const cls = "block rounded-xl bg-surface p-4 shadow-card text-fg no-underline";
  return href ? (
    <Link href={href} className={cx(cls, "hover:bg-surface-hover")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
