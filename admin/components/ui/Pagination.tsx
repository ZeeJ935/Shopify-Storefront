import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { cx } from "./cx";

/** Cursor pagination: back to the first page, and next. */
export function Pagination({ firstHref, nextHref }: { firstHref?: string | null; nextHref?: string | null }) {
  const cls = "inline-flex size-8 items-center justify-center rounded-lg bg-surface shadow-button text-fg";
  return (
    <div className="flex gap-1">
      {firstHref ? (
        <Link href={firstHref} aria-label="First page" className={cls}>
          <ChevronLeftIcon className="size-4" />
        </Link>
      ) : (
        <span className={cx(cls, "opacity-40")} aria-hidden="true">
          <ChevronLeftIcon className="size-4" />
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} aria-label="Next page" className={cls}>
          <ChevronRightIcon className="size-4" />
        </Link>
      ) : (
        <span className={cx(cls, "opacity-40")} aria-hidden="true">
          <ChevronRightIcon className="size-4" />
        </span>
      )}
    </div>
  );
}
