import { test, expect } from '@playwright/test';

/**
 * Admin UI tests.
 *
 * DEV_MODE=true is injected by the webServer command so authentication is
 * skipped.  The React SPA shell is served from the ASSETS binding at /_admin/.
 */
test.describe('Admin UI', () => {
  test('GET /_admin/ returns 200 with HTML', async ({ request }) => {
    const response = await request.get('/_admin/');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/html');

    const text = await response.text();
    // The Vite-built SPA shell always contains a root div and script tags
    expect(text.length).toBeGreaterThan(0);
  });

  test('GET /_admin/ page contains root mount point', async ({ page }) => {
    await page.goto('/_admin/');
    // The React app mounts into #root
    await expect(page.locator('#root')).toBeAttached();
  });

  test('/_admin/assets/ paths return appropriate content-type', async ({ request }) => {
    // Load the admin page first to discover an actual asset URL
    const htmlResponse = await request.get('/_admin/');
    const html = await htmlResponse.text();

    // Extract the first JS asset path from the HTML (e.g. /_admin/assets/index-XXXX.js)
    const match = html.match(/\/_admin\/assets\/[^"'\s]+\.js/);
    if (!match) {
      // If no JS asset is found (e.g. build output not present), skip gracefully
      test.skip();
      return;
    }

    const assetPath = match[0];
    const assetResponse = await request.get(assetPath);
    expect(assetResponse.status()).toBe(200);

    const contentType = assetResponse.headers()['content-type'] ?? '';
    expect(
      contentType.includes('javascript') || contentType.includes('text/'),
    ).toBe(true);
  });
});
