export type DiffStatus = "match" | "differs" | "large_decrease" | "unknown_location" | "unknown_sku" | "ambiguous_sku" | "untracked" | "not_stocked";

export type WarehouseDiffRow = {
  sku: string;
  locationShopifyId: string;
  locationName: string | null;
  inventoryItemShopifyId: string | null;
  warehouseQuantity: number;
  onHand: number | null;
  available: number | null;
  committed: number | null;
  difference: number | null;
  status: DiffStatus;
  stale: boolean;
  mirrorSyncedAt: string | null;
};

export type WarehouseDiff = { mode: "dry_run" | "live"; maxDecrease: number; lastReconcileAt: string | null; rows: WarehouseDiffRow[] };

export type PushBody = { all?: true; skus?: string[]; allow_large_decrease: boolean; dry_run: boolean };

export type WarehousePush = { key: string; status: "queued" | "running" | "done"; dryRun: boolean; itemCount: number; createdAt: string; finishedAt: string | null };

export type PushLogRow = { inventoryItemId: string; locationId: string | null; sku: string | null; from: number | null; to: number | null; attempt: number; result: string; final: boolean; error: string | null; at: string };
