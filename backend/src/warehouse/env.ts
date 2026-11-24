export type WarehouseEnv = {
  /** Global switch. "dry_run" (default when unset): pushes only log what they would set. */
  pushMode: "dry_run" | "live";
  /** Largest on_hand decrease a push may make without allow_large_decrease. */
  maxDecrease: number;
};

export function readWarehouseEnv(source: NodeJS.ProcessEnv): WarehouseEnv {
  const mode = source.WAREHOUSE_PUSH_MODE?.trim().toLowerCase() || "dry_run";
  if (mode !== "dry_run" && mode !== "live") throw new Error("WAREHOUSE_PUSH_MODE must be dry_run or live.");
  const rawMax = source.WAREHOUSE_MAX_DECREASE?.trim();
  const maxDecrease = rawMax ? Number(rawMax) : 10;
  if (!Number.isInteger(maxDecrease) || maxDecrease < 0) throw new Error("WAREHOUSE_MAX_DECREASE must be a whole number ≥ 0.");
  return { pushMode: mode, maxDecrease };
}
