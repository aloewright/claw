import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { OPENCLAW_PORT } from '../config';
import { findExistingOpenClawProcess } from '../gateway';
import { isAuthServiceMode } from '../auth';


/**
 * Public routes - NO Cloudflare Access authentication required
 *
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'openclaw-sandbox',
    gateway_port: OPENCLAW_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const process = await findExistingOpenClawProcess(sandbox);
    if (!process) {
      return c.json({ ok: false, status: 'not_running' });
    }

    // Process exists, check if it's actually responding
    // Try to reach the gateway with a short timeout
    try {
      await process.waitForPort(18789, { mode: 'tcp', timeout: 5000 });
      return c.json({ ok: true, status: 'running', processId: process.id });
    } catch {
      return c.json({ ok: false, status: 'not_responding', processId: process.id });
    }
  } catch (err) {
    return c.json({
      ok: false,
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

// ---------------------------------------------------------------------------
// Auth routes — redirect to cloudos-auth UI on auth.pdx.software
// Session cookie is set on .pdx.software so both subdomains share it.
// ---------------------------------------------------------------------------

function sanitizeNext(raw: string): string {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep raw on malformed encoding */ }
  if (!decoded || decoded.includes('://') || decoded.startsWith('//')) return '/';
  return '/' + decoded.replace(/^\/+/, '');
}

// GET /login — redirect to cloudos-auth UI
publicRoutes.get('/login', (c) => {
  if (!isAuthServiceMode(c.env)) return c.redirect('/_admin/');
  const next = c.req.query('next') ?? '/';
  return c.redirect(`https://auth.pdx.software/login?redirect=${encodeURIComponent('https://agent.pdx.software' + sanitizeNext(next))}`);
});

// GET /auth/sign-out — forward to auth service for sign-out and redirect
publicRoutes.get('/auth/sign-out', async (c) => {
  // Best-effort: revoke session in auth service by forwarding cookies
  if (c.env.AUTH_SERVICE) {
    const cookie = c.req.header('Cookie') ?? '';
    if (cookie) {
      c.executionCtx.waitUntil(
        c.env.AUTH_SERVICE.fetch('http://internal/api/auth/sign-out', {
          method: 'POST',
          headers: { Cookie: cookie },
        }).catch(() => {}),
      );
    }
  }

  // Redirect to login; the auth service clears its own cookies on sign-out
  return c.redirect('/login');
});

export { publicRoutes };
