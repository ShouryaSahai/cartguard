import { expect, test } from "@playwright/test";

// End-to-end coverage of the three demo paths plus the policy editor, running
// the real built app against mock rails. Screenshots land in docs/screenshots/
// for the README and Devpost.

const GOAL_INPUT = 'input[placeholder*="Wireless earbuds under"]';
const BUDGET_INPUT = 'input[aria-label="budget in USD"]';
// The goal input submits on Enter — a real user path that avoids a
// headless-shell click-actionability quirk on the accent button.
const SUBMIT = (page) => page.locator(GOAL_INPUT).press("Enter");

test.describe.serial("CartGuard end-to-end", () => {
  test("auto_pay path: small purchase captures without approval", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("New shopping request")).toBeVisible();
    await page.locator(GOAL_INPUT).fill("Wireless earbuds under $60 with good reviews");
    await page.locator(BUDGET_INPUT).fill("60");
    await SUBMIT(page);
    await expect(page.getByText("auto_paid ✓")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Payment captured in PayPal sandbox")).toBeVisible();
    await page.screenshot({ path: "docs/screenshots/path-auto-pay.png", fullPage: true });
  });

  test("policy editor: without admin token it refuses, with token it saves", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Policy editor" }).click();

    // No token: cancelling the admin-token modal must produce a clear error
    // and no save.
    await page.locator('button:has-text("Save policy")').click();
    await expect(page.getByRole("dialog", { name: "Admin token required" })).toBeVisible();
    await page.locator('div[role="dialog"] button:has-text("Cancel")').click();
    await expect(page.getByText("Admin token required — nothing was saved.")).toBeVisible();
    await page.screenshot({ path: "docs/screenshots/policy-editor-no-token.png", fullPage: true });

    // With the token: fill the new cap FIRST, then authenticate — one
    // deterministic save (asserting saved ✓ twice would race the page close).
    await page.locator('label:has-text("Per-purchase cap") input').fill("20");
    await page.locator('button:has-text("Save policy")').click();
    await page.locator('input[aria-label="admin token"]').fill("e2e-admin");
    await page.locator('div[role="dialog"] button:has-text("Continue")').click();
    await expect(page.getByText("saved ✓")).toBeVisible();
    await page.screenshot({ path: "docs/screenshots/policy-editor-saved.png", fullPage: true });
  });

  test("needs_approval path: approve captures", async ({ page }) => {
    await page.goto("/");
    await page.locator(GOAL_INPUT).fill("Laptop around $400 for uni");
    await page.locator(BUDGET_INPUT).fill("450");
    await SUBMIT(page);
    await expect(page.getByText("needs your approval")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("The gate needs a human decision before any money moves.")).toBeVisible();
    await page.screenshot({ path: "docs/screenshots/path-needs-approval.png", fullPage: true });
    await page.locator('button:has-text("Approve")').first().click();
    await expect(page.getByText("Payment captured in PayPal sandbox")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "docs/screenshots/path-approved.png", fullPage: true });
  });

  test("needs_approval path: reject keeps money untouched", async ({ page }) => {
    await page.goto("/");
    await page.locator(GOAL_INPUT).fill("Laptop around $400 for uni");
    await page.locator(BUDGET_INPUT).fill("450");
    await SUBMIT(page);
    await expect(page.getByText("needs your approval")).toBeVisible({ timeout: 30_000 });
    await page.locator('button:has-text("Reject")').click();
    await expect(page.getByText("Rejected by you. Nothing was purchased.")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "docs/screenshots/path-rejected.png", fullPage: true });
  });

  test("blocked path: over-budget bait is refused", async ({ page }) => {
    await page.goto("/");
    await page.locator(GOAL_INPUT).fill("Noise-cancelling headphones under $20");
    await page.locator(BUDGET_INPUT).fill("20");
    await SUBMIT(page);
    await expect(page.getByText("Blocked by policy. Nothing was purchased.")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "docs/screenshots/path-blocked.png", fullPage: true });
  });

  test("audit grid shows the decisions", async ({ page }) => {
    await page.goto("/");
    await page.locator('button:has-text("Audit log")').click();
    await expect(page.getByText("Decision audit log")).toBeVisible();
    await expect(page.locator(".ag-center-cols-container .ag-row").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "docs/screenshots/audit-grid.png", fullPage: true });
  });
});
