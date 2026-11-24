import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { LinkButton } from "@/components/ui/Button";
import { IndexTable } from "@/components/ui/IndexTable";
import { Page } from "@/components/ui/Page";
import { BackendError } from "@/lib/backend";
import { pushResultBadge, pushStatusBadge } from "@/lib/badges";
import { formatDate } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { PushLogRow, WarehousePush } from "@/lib/types-warehouse";

export default async function PushPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) notFound();
  let data: { push: WarehousePush; log: PushLogRow[] };
  try {
    data = await staffFetch(`/admin/warehouse/pushes/${encodeURIComponent(key)}`);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    throw error;
  }
  const { push, log } = data;
  const s = pushStatusBadge(push.status);
  const done = push.status === "done";
  const gaveUp = log.filter((l) => l.result === "conflict_gave_up" || l.result === "failed").length;

  return (
    <Page
      title="Warehouse push"
      backHref="/warehouse"
      titleMeta={
        <>
          <Badge tone={s.tone}>{s.label}</Badge>
          {push.dryRun ? <Badge tone="info">Dry run</Badge> : null}
        </>
      }
      subtitle={`${push.itemCount} item${push.itemCount === 1 ? "" : "s"} · started ${formatDate(push.createdAt)}${push.finishedAt ? ` · finished ${formatDate(push.finishedAt)}` : ""}`}
      actions={<LinkButton href="/warehouse">Back to warehouse</LinkButton>}
    >
      <AutoRefresh active={!done} />
      {!done ? <Banner tone="info" title="Working on it">This page refreshes every few seconds.</Banner> : null}
      {done && gaveUp ? (
        <Banner tone="critical" title={`${gaveUp} row${gaveUp === 1 ? "" : "s"} could not be pushed`}>
          Shopify&apos;s on_hand kept changing (or the request failed). Shopify was not overwritten; try again later.
        </Banner>
      ) : null}
      <IndexTable
        columns={[
          { key: "sku", label: "SKU" },
          { key: "result", label: "Result" },
          { key: "from", label: "on_hand before", align: "end" },
          { key: "to", label: "Set to", align: "end" },
          { key: "attempt", label: "Attempt", align: "end" },
          { key: "error", label: "Note", className: "hidden md:table-cell" },
          { key: "at", label: "Time", className: "hidden md:table-cell" },
        ]}
        rows={log.map((l, i) => {
          const b = pushResultBadge(l.result);
          return {
            key: String(i),
            cells: {
              sku: <span className="font-medium">{l.sku ?? "—"}</span>,
              result: <Badge tone={b.tone}>{b.label}</Badge>,
              from: l.from ?? "—",
              to: l.to ?? "—",
              attempt: l.attempt,
              error: <span className="text-subdued">{l.error ?? ""}</span>,
              at: <span className="whitespace-nowrap text-subdued">{formatDate(l.at)}</span>,
            },
          };
        })}
        empty={<p className="text-center text-subdued">Waiting for the first item…</p>}
      />
    </Page>
  );
}
