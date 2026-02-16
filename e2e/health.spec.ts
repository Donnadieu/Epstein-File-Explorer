import { test, expect } from "@playwright/test";

test.describe("Application Health", () => {
  test("homepage loads successfully", async ({ page }) => {
    await page.goto("/");
    // The app should render the dashboard
    await expect(page).toHaveTitle(/Epstein/i);
  });

  test("API stats endpoint responds", async ({ request }) => {
    const response = await request.get("/api/stats");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("personCount");
    expect(body).toHaveProperty("documentCount");
    expect(body).toHaveProperty("pageCount");
  });

  test("documents page loads", async ({ page }) => {
    await page.goto("/documents");
    // Wait for content to load
    await page.waitForLoadState("networkidle");
    // Should see document listing
    await expect(page.locator("body")).toContainText(/document/i);
  });

  test("persons page loads", async ({ page }) => {
    await page.goto("/people");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText(/person|people/i);
  });

  test("search page loads", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText(/search/i);
  });
});
