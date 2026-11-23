import { describe, expect, it } from "vitest";
import { shouldApply } from "../src/webhooks/ordering.js";

describe("shouldApply", () => {
  it("applies when incoming is newer or equal", () => {
    expect(shouldApply("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")).toBe(true);
    expect(shouldApply("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("ignores when incoming is strictly older", () => {
    expect(shouldApply("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("applies when either side is missing", () => {
    expect(shouldApply(null, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(shouldApply("2026-01-01T00:00:00.000Z", null)).toBe(true);
    expect(shouldApply(undefined, undefined)).toBe(true);
  });
});
