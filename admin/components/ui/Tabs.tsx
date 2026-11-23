import Link from "next/link";
import { cx } from "./cx";

/** Link tabs (e.g. All / Unfulfilled / Unpaid) shown at the top of an index table. */
export function Tabs({ tabs }: { tabs: { label: string; href: string; selected: boolean }[] }) {
  return (
    <nav aria-label="Views" className="flex gap-1 overflow-x-auto px-2 py-1.5">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.selected ? "page" : undefined}
          className={cx(
            "rounded-lg px-3 py-1.5 font-medium whitespace-nowrap no-underline",
            t.selected ? "bg-surface-selected text-fg" : "text-subdued hover:bg-surface-hover hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
