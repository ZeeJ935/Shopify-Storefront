import { SyncPanel } from "@/components/SyncPanel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { IndexTable } from "@/components/ui/IndexTable";
import { Page } from "@/components/ui/Page";
import { Pagination } from "@/components/ui/Pagination";
import { auditBadge, roleLabel } from "@/lib/badges";
import { formatDate } from "@/lib/fulfill";
import { requireSession, staffFetch } from "@/lib/session-server";
import type { AuditEntry } from "@/lib/types";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.refresh": "Session refresh",
  "fulfillment.create": "Fulfillment",
  "sync.catalog": "Catalog sync",
  "sync.inventory": "Inventory sync",
  "sync.orders": "Orders sync",
  "audit.read": "Viewed audit log",
  sync: "Sync",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await requireSession("admin");
  const { before } = await searchParams;
  const q = new URLSearchParams({ limit: "50" });
  if (before && /^\d{1,20}$/.test(before)) q.set("before", before);
  const { entries, nextBefore } = await staffFetch<{ entries: AuditEntry[]; nextBefore: number | null }>(`/admin/audit?${q}`);

  return (
    <Page title="Audit log" subtitle="Who did what, and when. No customer data is recorded." actions={<SyncPanel />}>
      <IndexTable
        columns={[
          { key: "when", label: "Date" },
          { key: "who", label: "Staff" },
          { key: "action", label: "Action" },
          { key: "resource", label: "Resource", className: "hidden md:table-cell" },
          { key: "result", label: "Result" },
          { key: "detail", label: "Detail", className: "hidden lg:table-cell" },
        ]}
        rows={entries.map((e) => {
          const b = auditBadge(e.result);
          return {
            key: String(e.id),
            cells: {
              when: <span className="whitespace-nowrap text-subdued">{formatDate(e.at)}</span>,
              who: e.staffEmail ? (
                <span>
                  {e.staffEmail}
                  {e.role ? <span className="block text-xs text-subdued">{roleLabel(e.role)}</span> : null}
                </span>
              ) : (
                <span className="text-subdued">Unknown (not signed in)</span>
              ),
              action: <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>,
              resource: <span className="font-mono text-xs break-all text-subdued">{e.resourceId ?? "—"}</span>,
              result: (
                <span className="flex items-center gap-1.5">
                  <Badge tone={b.tone}>{b.label}</Badge>
                  {e.statusCode ? <span className="text-xs text-subdued">{e.statusCode}</span> : null}
                </span>
              ),
              detail: e.detail ? (
                <span className="flex flex-wrap gap-1">
                  {Object.entries(e.detail).map(([k, v]) => (
                    <span key={k} className="rounded-md bg-surface-subdued px-1.5 py-0.5 font-mono text-[11px] text-subdued">
                      {k}: {String(v)}
                    </span>
                  ))}
                </span>
              ) : null,
            },
          };
        })}
        empty={<EmptyState title="Nothing recorded yet" />}
        footer={before || nextBefore ? <Pagination firstHref={before ? "/audit" : null} nextHref={nextBefore ? `/audit?before=${nextBefore}` : null} /> : null}
      />
    </Page>
  );
}
