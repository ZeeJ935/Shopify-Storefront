import { AddStockForm, StockEditor } from "@/components/StockEditor";
import { PUSH_FORM_ID, WarehouseFlow } from "@/components/WarehouseFlow";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IndexTable } from "@/components/ui/IndexTable";
import { Page } from "@/components/ui/Page";
import { Tabs } from "@/components/ui/Tabs";
import { warehouseStatusBadge } from "@/lib/badges";
import { formatDate } from "@/lib/fulfill";
import { requireSession, staffFetch } from "@/lib/session-server";
import type { LocationView } from "@/lib/types";
import type { WarehouseDiff } from "@/lib/types-warehouse";
import { canEditStock, canPush, PUSHABLE, signed } from "@/lib/warehouse";

export default async function WarehousePage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const { staff } = await requireSession();
  const only = (await searchParams).only === "differences";
  const diff = await staffFetch<WarehouseDiff>(`/admin/warehouse/diff${only ? "?only=differences" : ""}`);
  const pushAllowed = canPush(staff.role);
  const editAllowed = canEditStock(staff.role);
  const locations = editAllowed ? (await staffFetch<{ locations: LocationView[] }>("/admin/inventory/locations")).locations : [];
  const differing = diff.rows.filter((r) => PUSHABLE.has(r.status)).length;

  return (
    <Page
      title="Warehouse"
      subtitle={`Mock warehouse vs Shopify on_hand · last reconcile ${diff.lastReconcileAt ? formatDate(diff.lastReconcileAt) : "never"} · large decrease means more than ${diff.maxDecrease} units`}
    >
      {diff.mode === "dry_run" ? (
        <Banner tone="info" title="Dry run mode">
          The backend runs with WAREHOUSE_PUSH_MODE=dry_run: pushes only log what they would set. Nothing is written to Shopify.
        </Banner>
      ) : null}
      {pushAllowed && diff.rows.length ? <WarehouseFlow differing={differing} /> : null}
      <IndexTable
        toolbar={
          <Tabs
            tabs={[
              { label: "All rows", href: "/warehouse", selected: !only },
              { label: "Differences only", href: "/warehouse?only=differences", selected: only },
            ]}
          />
        }
        columns={[
          ...(pushAllowed ? [{ key: "pick", label: "", className: "w-8" }] : []),
          { key: "sku", label: "SKU" },
          { key: "location", label: "Location" },
          { key: "status", label: "Status" },
          { key: "warehouse", label: "Warehouse", align: "end" as const },
          { key: "onHand", label: "on_hand", align: "end" as const },
          { key: "difference", label: "Difference", align: "end" as const },
          { key: "available", label: "Available", align: "end" as const, className: "text-subdued" },
          { key: "committed", label: "Committed", align: "end" as const, className: "text-subdued" },
          ...(editAllowed ? [{ key: "edit", label: "Edit stock", align: "end" as const }] : []),
        ]}
        rows={diff.rows.map((r) => {
          const b = warehouseStatusBadge(r.status);
          const pushable = PUSHABLE.has(r.status);
          return {
            key: `${r.sku}|${r.locationShopifyId}`,
            cells: {
              pick: pushable ? <input type="checkbox" name="sku" value={r.sku} form={PUSH_FORM_ID} aria-label={`Select ${r.sku}`} className="size-4 accent-[var(--primary)]" /> : null,
              sku: <span className="font-medium">{r.sku}</span>,
              location: <span className="text-subdued">{r.locationName ?? "Unknown"}</span>,
              status: (
                <span className="flex items-center gap-1.5">
                  <Badge tone={b.tone}>{b.label}</Badge>
                  {r.stale ? <span title={`Mirror synced ${formatDate(r.mirrorSyncedAt)}`} className="text-xs text-subdued">stale</span> : null}
                </span>
              ),
              warehouse: <span className="font-semibold">{r.warehouseQuantity}</span>,
              onHand: r.onHand ?? "—",
              difference: <span className={r.difference && r.difference < 0 ? "text-critical" : undefined}>{signed(r.difference)}</span>,
              available: r.available ?? "—",
              committed: r.committed ?? "—",
              edit: editAllowed ? <StockEditor sku={r.sku} locationId={r.locationShopifyId} quantity={r.warehouseQuantity} /> : null,
            },
          };
        })}
        empty={<EmptyState title={only ? "Everything is in sync" : "The mock warehouse is empty"}>{editAllowed ? "Add a SKU below to start." : "An admin can add stock to the mock warehouse."}</EmptyState>}
      />
      {editAllowed ? (
        <Card title="Add stock to the mock warehouse">
          <AddStockForm locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
        </Card>
      ) : null}
    </Page>
  );
}
