import { cx } from "./cx";

export type Column = { key: string; label: string; align?: "start" | "end"; className?: string };

/**
 * Shopify-style list table: subdued header, row hover, right-aligned numbers.
 * Rows are given as cells keyed by column; the first cell usually holds the link.
 * The scroll box is `relative` so absolutely positioned children (e.g. sr-only labels)
 * stay inside it instead of widening the page on mobile.
 */
export function IndexTable({
  columns,
  rows,
  empty,
  toolbar,
  footer,
}: {
  columns: Column[];
  rows: { key: string; cells: Record<string, React.ReactNode> }[];
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-card">
      {toolbar ? <div className="border-b border-line">{toolbar}</div> : null}
      {rows.length === 0 ? (
        <div className="px-4 py-12">{empty}</div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-subdued text-xs text-subdued">
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cx("px-3 py-2 font-medium whitespace-nowrap first:pl-4 last:pr-4", c.align === "end" && "text-right", c.className)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-line hover:bg-surface-hover">
                  {columns.map((c) => (
                    <td key={c.key} className={cx("px-3 py-2.5 align-middle first:pl-4 last:pr-4", c.align === "end" && "text-right tabular-nums", c.className)}>
                      {row.cells[c.key] ?? null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer ? <div className="flex items-center justify-center gap-2 border-t border-line px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}
