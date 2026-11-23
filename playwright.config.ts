import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a local production build (npm run build first).
// They start the backend (backend/dist) and `next start` unless already running.
// They read real catalog data, never check out, never log in, and delete nothing.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const CI = Boolean(process.env.CI);
// CI starts the backend before `next build` (the build reads the catalog), so it reuses it.
const reuse = !CI || process.env.E2E_REUSE === "1";

export default defineConfig({
  testDir: "e2e",
  // One worker: the tests share one backend and the per-IP rate limits.
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm --prefix backend start",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: reuse,
      timeout: 120_000,
    },
  ],
});
