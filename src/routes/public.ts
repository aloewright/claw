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
// Auth routes — only active when AUTH_SERVICE binding is configured
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeNext(raw: string): string {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep raw on malformed encoding */ }
  // Reject absolute URLs, protocol-relative URLs, and percent-encoded schemes
  if (!decoded || decoded.includes('://') || decoded.startsWith('//')) return '/';
  return '/' + decoded.replace(/^\/+/, '');
}

const LOGIN_PAGE = (error?: string, next?: string, mode: 'signin' | 'signup' = 'signin') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claw — ${mode === 'signin' ? 'Sign in' : 'Sign up'}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e5e5e5;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
            padding: 2rem; width: 100%; max-width: 360px; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 0.3rem; }
    input { width: 100%; padding: 0.6rem 0.75rem; background: #0f0f0f; border: 1px solid #333;
            border-radius: 6px; color: #e5e5e5; font-size: 0.9rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #555; }
    button { width: 100%; padding: 0.65rem; background: #e5e5e5; color: #0f0f0f;
             border: none; border-radius: 6px; font-size: 0.9rem; font-weight: 600;
             cursor: pointer; }
    button:hover { background: #fff; }
    .error { color: #f87171; font-size: 0.8rem; margin-bottom: 1rem; }
    .toggle { text-align: center; margin-top: 1rem; font-size: 0.8rem; color: #888; }
    .toggle a { color: #e5e5e5; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${mode === 'signin' ? 'Sign in to Claw' : 'Create an account'}</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="${mode === 'signin' ? '/auth/sign-in' : '/auth/sign-up'}">
      ${next && next !== '/' ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : ''}
      ${mode === 'signup' ? '<label>Name</label>\n      <input type="text" name="name" autocomplete="name" required />' : ''}
      <label>Email</label>
      <input type="email" name="email" autocomplete="email" required autofocus />
      <label>Password</label>
      <input type="password" name="password" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" required />
      <button type="submit">${mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
    </form>
    <p class="toggle">
      ${mode === 'signin'
        ? `Don't have an account? <a href="/login?mode=signup${next && next !== '/' ? '&next=' + escapeHtml(encodeURIComponent(next)) : ''}">Sign up</a>`
        : `Already have an account? <a href="/login${next && next !== '/' ? '?next=' + escapeHtml(encodeURIComponent(next)) : ''}">Sign in</a>`}
    </p>
  </div>
</body>
</html>`;

// GET /login — login page (only in auth service mode)
publicRoutes.get('/login', (c) => {
  if (!isAuthServiceMode(c.env)) return c.redirect('/_admin/');
  const next = sanitizeNext(c.req.query('next') ?? '');
  const mode = c.req.query('mode') === 'signup' ? 'signup' : 'signin';
  return c.html(LOGIN_PAGE(undefined, next, mode));
});

// POST /auth/sign-in — proxy sign-in to cloudos-auth, relay session token as cookie
publicRoutes.post('/auth/sign-in', async (c) => {
  if (!isAuthServiceMode(c.env)) {
    return c.json({ error: 'Auth service not configured' }, 503);
  }

  const body = await c.req.parseBody();
  const email = (body['email'] as string | undefined)?.trim();
  const password = body['password'] as string | undefined;
  // Read next from query string first, then hidden form field
  const rawNext = c.req.query('next') || (body['next'] as string | undefined) || '/';
  const next = sanitizeNext(rawNext);

  if (!email || !password) {
    return c.html(LOGIN_PAGE('Email and password are required.', next), 400);
  }

  let token: string | undefined;
  let authError: string | undefined;

  try {
    const resp = await c.env.AUTH_SERVICE!.fetch('http://internal/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (resp.ok) {
      const data = (await resp.json()) as { token?: string };
      token = data.token;
    } else {
      const err = (await resp.json().catch(() => ({}))) as { message?: string };
      authError = err.message || 'Invalid email or password.';
    }
  } catch {
    authError = 'Auth service unavailable. Please try again.';
  }

  if (!token) {
    return c.html(LOGIN_PAGE(authError || 'Sign in failed.', next), 401);
  }

  // Set HttpOnly session cookie on claw's domain
  const isSecure = new URL(c.req.url).protocol === 'https:';
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${isSecure ? '; Secure' : ''}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': `claw_session=${token}; ${cookieFlags}`,
    },
  });
});

// POST /auth/sign-up — proxy sign-up to cloudos-auth, then sign in
publicRoutes.post('/auth/sign-up', async (c) => {
  if (!isAuthServiceMode(c.env)) {
    return c.json({ error: 'Auth service not configured' }, 503);
  }

  const body = await c.req.parseBody();
  const name = (body['name'] as string | undefined)?.trim();
  const email = (body['email'] as string | undefined)?.trim();
  const password = body['password'] as string | undefined;
  const rawNext = c.req.query('next') || (body['next'] as string | undefined) || '/';
  const next = sanitizeNext(rawNext);

  if (!email || !password || !name) {
    return c.html(LOGIN_PAGE('Name, email, and password are required.', next, 'signup'), 400);
  }

  try {
    // Create account
    const signUpResp = await c.env.AUTH_SERVICE!.fetch('http://internal/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    const signUpBody = await signUpResp.text();
    let signUpData: Record<string, unknown> = {};
    try { signUpData = JSON.parse(signUpBody); } catch { /* not JSON */ }

    if (!signUpResp.ok) {
      // better-auth returns errors as { message }, { error }, or { error: { message } }
      const msg =
        (signUpData as { message?: string }).message ||
        (typeof signUpData.error === 'string' ? signUpData.error : null) ||
        ((signUpData.error as { message?: string })?.message) ||
        `Sign up failed (${signUpResp.status}): ${signUpBody.slice(0, 200)}`;
      return c.html(LOGIN_PAGE(msg, next, 'signup'), 400);
    }

    // If email verification is required, the sign-up succeeds but no session is returned.
    // The user needs to verify their email before signing in.
    const signUpToken = (signUpData as { token?: string }).token;

    // Try to sign in immediately (works when email verification is not required)
    const signInResp = await c.env.AUTH_SERVICE!.fetch('http://internal/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!signInResp.ok) {
      // Account created but sign-in failed — likely needs email verification
      return c.html(LOGIN_PAGE('Account created! Check your email to verify, then sign in.', next, 'signin'));
    }

    const signInData = (await signInResp.json()) as { token?: string };
    const token = signInData.token || signUpToken;
    if (!token) {
      return c.html(LOGIN_PAGE('Account created! Check your email to verify, then sign in.', next, 'signin'));
    }

    const isSecure = new URL(c.req.url).protocol === 'https:';
    const cookieFlags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${isSecure ? '; Secure' : ''}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: next,
        'Set-Cookie': `claw_session=${data.token}; ${cookieFlags}`,
      },
    });
  } catch {
    return c.html(LOGIN_PAGE('Auth service unavailable. Please try again.', next, 'signup'), 500);
  }
});

// GET /auth/sign-out — clear session cookie and redirect to login
publicRoutes.get('/auth/sign-out', async (c) => {
  // Best-effort: revoke session in auth service
  if (c.env.AUTH_SERVICE) {
    const cookie = c.req.header('Cookie') ?? '';
    const match = cookie.split(';').find((s) => s.trim().startsWith('claw_session='));
    const token = match?.split('=').slice(1).join('=').trim();
    if (token) {
      c.executionCtx.waitUntil(
        c.env.AUTH_SERVICE.fetch('http://internal/api/auth/sign-out', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {}),
      );
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': 'claw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    },
  });
});

export { publicRoutes };
