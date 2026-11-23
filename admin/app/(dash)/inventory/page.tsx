import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { inputClass } from "@/components/ui/Field";
import { IndexTable } from "@/components/ui/IndexTable";
import { Page } from "@/components/ui/Page";
import { Pagination } from "@/components/ui/Pagination";
import { stockBadge } from "@/lib/badges";
import { formatDate } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { InventoryLevel, LocationView } from "@/lib/types";

type Search = { sku?: string; location_id?: string; low_stock_below?: string; cursor?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { locations } = await staffFetch<{ locations: LocationView[] }>("/admin/inventory/locations");
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const filters: Record<string, string> = {};
  const sku = sp.sku?.trim().slice(0, 100);
  if (sku) filters.sku = sku;
  if (sp.location_id && names.has(sp.location_id)) filters.location_id = sp.location_id;
  if (sp.low_stock_below && /^\d{1,6}$/.test(sp.low_stock_below)) filters.low_stock_below = sp.low_stock_below;
  const q = new URLSearchParams({ limit: "50", ...filters });
  if (sp.cursor && /^[A-Za-z0-9_-]{1,500}$/.test(sp.cursor)) q.set("cursor", sp.cursor);
  const { levels, nextCursor } = await staffFetch<{ levels: InventoryLevel[]; nextCursor: string | null }>(`/admin/inventory/levels?${q}`);
  const base = new URLSearchParams(filters).toString();

  return (
    <Page title="Inventory" subtitle={`${locations.length} location${locations.length === 1 ? "" : "s"}`}>
      <IndexTable
        toolbar={
          <form className="flex flex-wrap items-end gap-2 p-3">
            <input name="sku" placeholder="Exact SKU" defaultValue={sku ?? ""} aria-label="SKU" className={`${inputClass} w-44`} />
            <select name="location_id" defaultValue={filters.location_id ?? ""} aria-label="Location" className={`${inputClass} w-48`}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <select name="low_stock_below" defaultValue={filters.low_stock_below ?? ""} aria-label="Stock" className={`${inputClass} w-40`}>
              <option value="">Any stock</option>
              <option value="1">Out of stock</option>
              <option value="6">Low stock (≤ 5)</option>
              <option value="11">10 or fewer</option>
            </select>
            <Button type="submit">Apply</Button>
          </form>
        }
        columns={[
          { key: "sku", label: "SKU" },
          { key: "location", label: "Location" },
          { key: "status", label: "Status" },
          { key: "available", label: "Available", align: "end" },
          { key: "onHand", label: "On hand", align: "end" },
          { key: "committed", label: "Committed", align: "end" },
          { key: "incoming", label: "Incoming", align: "end" },
          { key: "updated", label: "Updated", className: "hidden md:table-cell" },
        ]}
        rows={levels.map((l) => {
          const b = stockBadge(l.available);
          return {
            key: `${l.inventoryItemId}|${l.locationId}`,
            cells: {
              sku: <span className="font-medium">{l.sku ?? "—"}</span>,
              location: <span className="text-subdued">{names.get(l.locationId) ?? "Unknown"}</span>,
              status: <Badge tone={b.tone}>{b.label}</Badge>,
              available: <span className="font-semibold">{l.available}</span>,
              onHand: l.onHand,
              committed: l.committed,
              incoming: l.incoming,
              updated: <span className="whitespace-nowrap text-subdued">{formatDate(l.shopifyUpdatedAt)}</span>,
            },
          };
        })}
        empty={<EmptyState title="No inventory matches">Clear the filters, or wait for the next inventory sync.</EmptyState>}
        footer={
          sp.cursor || nextCursor ? (
            <Pagination firstHref={sp.cursor ? `/inventory${base ? `?${base}` : ""}` : null} nextHref={nextCursor ? `/inventory?${new URLSearchParams({ ...filters, cursor: nextCursor })}` : null} />
          ) : null
        }
      />
    </Page>
  );
}
