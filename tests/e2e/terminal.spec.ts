import { test, expect } from '@playwright/test';

/**
 * Terminal page UI tests.
 *
 * DEV_MODE=true bypasses auth so /_admin/ and /_admin/terminal are accessible.
 * We only test static rendering — no sandbox container is required.
 */
test.describe('Admin terminal page', () => {
  test('navigating to /_admin/ loads the page', async ({ page }) => {
    await page.goto('/_admin/');

    // The SPA shell should load without a hard error
    await expect(page).not.toHaveURL(/\/login/);

    // Wait for the React app to mount
    await expect(page.locator('#root')).toBeAttached();
  });

  test('page has a meaningful title or visible heading', async ({ page }) => {
    await page.goto('/_admin/');

    // Allow the React app to hydrate
    await page.waitForLoadState('networkidle');

    // At minimum the document title should be non-empty
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('terminal tool selector is present with aria-label "Tool"', async ({ page }) => {
    // Navigate directly to the terminal route
    await page.goto('/_admin/terminal');

    // Wait for the React app to hydrate
    await page.waitForLoadState('networkidle');

    // The terminal page renders a tool selector with aria-label="Tool"
    const toolSelector = page.locator('[aria-label="Tool"]');
    await expect(toolSelector).toBeVisible({ timeout: 10000 });
  });
});
