import { cx } from "./cx";

/** White surface with a soft border, like Shopify admin cards. */
export function Card({ title, actions, children, padded = true, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; padded?: boolean; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-xl bg-surface shadow-card", className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(padded && "px-4 pb-4", padded && !title && !actions && "pt-4")}>{children}</div>
    </section>
  );
}

export function CardSection({ title, children, subdued }: { title?: string; children: React.ReactNode; subdued?: boolean }) {
  return (
    <div className={cx("border-t border-line px-4 py-3", subdued && "bg-surface-subdued")}>
      {title ? <h3 className="mb-1 text-xs font-semibold text-subdued uppercase">{title}</h3> : null}
      {children}
    </div>
  );
}
