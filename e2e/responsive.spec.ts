import { expect, test } from "@playwright/test";

// Design-pass evidence: full-page screenshots at the three judged widths.
// View them (or diff against later runs) to catch layout regressions.

const WIDTHS = [375, 768, 1440] as const;

test.describe("responsive design evidence", () => {
  for (const width of WIDTHS) {
    test(`dashboard at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByText("New shopping request")).toBeVisible();
      await page.waitForTimeout(800); // let charts/grid settle
      await page.screenshot({ path: `docs/screenshots/responsive-${width}.png`, fullPage: true });
    });

    test(`insights at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.locator('button:has-text("Insights")').click();
      await expect(page.getByText("Captured spend over time")).toBeVisible();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `docs/screenshots/insights-${width}.png`, fullPage: true });
    });
  }
});
