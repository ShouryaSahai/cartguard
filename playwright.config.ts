import { defineConfig } from "@playwright/test";
import path from "node:path";

// End-to-end tests run the REAL built app (Express + built web bundle) against
// deterministic mock rails: CARTGUARD_MOCK_RAILS=1 swaps the LLM, Channel3 and
// PayPal clients for scripted fakes while the pipeline/gate/audit stay real.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(process.cwd(), ".tools/pw-browsers");

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
    // Full Chromium (not the headless shell): its screenshot pipeline is
    // reliable, the shell hangs on this page's compositor setup.
    launchOptions: { channel: "chromium" },
  },
  webServer: {
    command:
      `rm -f /tmp/cartguard-e2e.sqlite && npm run build && ` +
      `CARTGUARD_MOCK_RAILS=1 ADMIN_TOKEN=e2e-admin ` +
      `DB_PATH=/tmp/cartguard-e2e.sqlite PORT=${PORT} PUBLIC_BASE_URL=http://127.0.0.1:${PORT} ` +
      `node_modules/.bin/tsx apps/api/src/server.ts`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
