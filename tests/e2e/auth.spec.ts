import { test, expect } from '@playwright/test';

/**
 * Auth flow tests.
 *
 * The wrangler.jsonc declares an AUTH_SERVICE service binding to `cloudos-auth`,
 * so isAuthServiceMode() returns true in wrangler dev.  DEV_MODE=true is set via
 * the webServer command, which bypasses token validation in the access middleware
 * but does NOT affect the /login route itself — that only checks AUTH_SERVICE.
 *
 * Consequently:
 *  - GET /login renders the sign-in HTML form (AUTH_SERVICE binding present).
 *  - GET /login?next=/foo includes a hidden "next" input with value "/foo".
 *  - GET /login?next=/ does NOT include the hidden input (sanitized to "/").
 *  - POST /auth/sign-in with bad credentials returns 401 + the login page
 *    (the AUTH_SERVICE call fails / returns an error, so no session token).
 *  - GET /auth/sign-out always redirects to /login and clears the cookie.
 */
test.describe('Login page rendering', () => {
  test('GET /login renders the sign-in form', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('h1')).toHaveText('Sign in to Claw');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('GET /login?next=/foo preserves next in hidden input', async ({ page }) => {
    await page.goto('/login?next=%2Ffoo');

    const hiddenNext = page.locator('input[type="hidden"][name="next"]');
    await expect(hiddenNext).toHaveAttribute('value', '/foo');
  });

  test('GET /login?next=/ does not include hidden next input', async ({ page }) => {
    await page.goto('/login?next=%2F');

    // sanitizeNext returns '/' for plain '/', and the template omits the input when next === '/'
    const hiddenNext = page.locator('input[type="hidden"][name="next"]');
    await expect(hiddenNext).toHaveCount(0);
  });
});

test.describe('Sign-in endpoint', () => {
  test('POST /auth/sign-in with missing credentials returns 400 with login page', async ({
    request,
  }) => {
    // Empty form body — email and password are both missing
    const response = await request.post('/auth/sign-in', {
      form: {},
    });
    // The handler returns 400 when email/password are empty
    expect(response.status()).toBe(400);
    const text = await response.text();
    expect(text).toContain('Sign in to Claw');
  });
});

test.describe('Sign-out endpoint', () => {
  test('GET /auth/sign-out redirects to /login', async ({ request }) => {
    // Follow redirects is off so we can inspect the Location header
    const response = await request.get('/auth/sign-out', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toBe('/login');
  });

  test('GET /auth/sign-out clears the session cookie', async ({ request }) => {
    const response = await request.get('/auth/sign-out', {
      maxRedirects: 0,
    });
    const setCookie = response.headers()['set-cookie'] ?? '';
    // The cookie must be expired (Max-Age=0) to clear it
    expect(setCookie).toContain('claw_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});
