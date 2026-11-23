import Link from "next/link";
import { ChevronLeftIcon } from "./Icons";
import { cx } from "./cx";

/** Page header: back arrow, title, optional badges/subtitle, and actions on the right. */
export function Page({
  title,
  backHref,
  titleMeta,
  subtitle,
  actions,
  narrow,
  children,
}: {
  title: React.ReactNode;
  backHref?: string;
  titleMeta?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("mx-auto w-full px-4 py-5 sm:px-6", narrow ? "max-w-3xl" : "max-w-6xl")}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {backHref ? (
            <Link href={backHref} aria-label="Back" className="mt-0.5 rounded-lg p-1 text-fg hover:bg-surface-hover">
              <ChevronLeftIcon className="size-4" />
            </Link>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{title}</h1>
              {titleMeta}
            </div>
            {subtitle ? <p className="mt-0.5 text-subdued">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

/** Main + sidebar columns (stacked on small screens). */
export function Layout({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      <div className="flex min-w-0 flex-col gap-4">{aside}</div>
    </div>
  );
}
