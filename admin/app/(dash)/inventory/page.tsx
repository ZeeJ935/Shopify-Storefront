import Link from "next/link";
import { formatDate } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { InventoryLevel, LocationView } from "@/lib/types";

type Search = { sku?: string; location_id?: string; low_stock_below?: string; cursor?: string };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { locations: locationList } = await staffFetch<{ locations: LocationView[] }>("/admin/inventory/locations");
  const names = new Map(locationList.map((l) => [l.id, l.name]));

  const q = new URLSearchParams({ limit: "50" });
  const sku = sp.sku?.trim().slice(0, 100);
  const location = sp.location_id && names.has(sp.location_id) ? sp.location_id : undefined;
  const low = sp.low_stock_below && /^\d{1,6}$/.test(sp.low_stock_below) ? sp.low_stock_below : undefined;
  if (sku) q.set("sku", sku);
  if (location) q.set("location_id", location);
  if (low) q.set("low_stock_below", low);
  if (sp.cursor && /^[A-Za-z0-9_-]{1,500}$/.test(sp.cursor)) q.set("cursor", sp.cursor);
  const { levels, nextCursor } = await staffFetch<{ levels: InventoryLevel[]; nextCursor: string | null }>(`/admin/inventory/levels?${q}`);
  const next = new URLSearchParams({ ...(sku ? { sku } : {}), ...(location ? { location_id: location } : {}), ...(low ? { low_stock_below: low } : {}) });
  if (nextCursor) next.set("cursor", nextCursor);

  return (
    <>
      <h1>Inventory</h1>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input name="sku" placeholder="Exact SKU" defaultValue={sku ?? ""} />
        <select name="location_id" defaultValue={location ?? ""}>
          <option value="">All locations</option>
          {locationList.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <input name="low_stock_below" placeholder="Available below" inputMode="numeric" defaultValue={low ?? ""} style={{ width: 140 }} />
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Location</th>
            <th>Available</th>
            <th>On hand</th>
            <th>Committed</th>
            <th>Incoming</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={`${l.inventoryItemId}|${l.locationId}`}>
              <td>{l.sku ?? "—"}</td>
              <td>{names.get(l.locationId) ?? l.locationId}</td>
              <td className={l.available <= 0 ? "error" : undefined}>{l.available}</td>
              <td>{l.onHand}</td>
              <td>{l.committed}</td>
              <td>{l.incoming}</td>
              <td>{formatDate(l.shopifyUpdatedAt)}</td>
            </tr>
          ))}
          {levels.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                No levels match.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {nextCursor ? (
        <p>
          <Link href={`/inventory?${next}`}>Next page →</Link>
        </p>
      ) : null}
    </>
  );
}
