import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isDevMode, isE2ETestMode, extractJWT, validateWithAuthService, isAuthServiceMode } from './middleware';
import type { OpenClawEnv } from '../types';
import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { createMockEnv } from '../test-utils';

describe('isDevMode', () => {
  it('returns true when DEV_MODE is "true"', () => {
    const env = createMockEnv({ DEV_MODE: 'true' });
    expect(isDevMode(env)).toBe(true);
  });

  it('returns false when DEV_MODE is undefined', () => {
    const env = createMockEnv();
    expect(isDevMode(env)).toBe(false);
  });

  it('returns false when DEV_MODE is "false"', () => {
    const env = createMockEnv({ DEV_MODE: 'false' });
    expect(isDevMode(env)).toBe(false);
  });

  it('returns false when DEV_MODE is any other value', () => {
    const env = createMockEnv({ DEV_MODE: 'yes' });
    expect(isDevMode(env)).toBe(false);
  });

  it('returns false when DEV_MODE is empty string', () => {
    const env = createMockEnv({ DEV_MODE: '' });
    expect(isDevMode(env)).toBe(false);
  });
});

describe('isE2ETestMode', () => {
  it('returns true when E2E_TEST_MODE is "true"', () => {
    const env = createMockEnv({ E2E_TEST_MODE: 'true' });
    expect(isE2ETestMode(env)).toBe(true);
  });

  it('returns false when E2E_TEST_MODE is undefined', () => {
    const env = createMockEnv();
    expect(isE2ETestMode(env)).toBe(false);
  });

  it('returns false when E2E_TEST_MODE is "false"', () => {
    const env = createMockEnv({ E2E_TEST_MODE: 'false' });
    expect(isE2ETestMode(env)).toBe(false);
  });

  it('returns false when E2E_TEST_MODE is any other value', () => {
    const env = createMockEnv({ E2E_TEST_MODE: 'yes' });
    expect(isE2ETestMode(env)).toBe(false);
  });
});

describe('extractJWT', () => {
  // Helper to create a mock context
  function createMockContext(options: { jwtHeader?: string; cookies?: string }): Context<AppEnv> {
    const headers = new Headers();
    if (options.jwtHeader) {
      headers.set('CF-Access-JWT-Assertion', options.jwtHeader);
    }
    if (options.cookies) {
      headers.set('Cookie', options.cookies);
    }

    return {
      req: {
        header: (name: string) => headers.get(name),
        raw: {
          headers,
        },
      },
    } as unknown as Context<AppEnv>;
  }

  it('extracts JWT from CF-Access-JWT-Assertion header', () => {
    const jwt = 'header.payload.signature';
    const c = createMockContext({ jwtHeader: jwt });
    expect(extractJWT(c)).toBe(jwt);
  });

  it('extracts JWT from CF_Authorization cookie', () => {
    const jwt = 'cookie.payload.signature';
    const c = createMockContext({ cookies: `CF_Authorization=${jwt}` });
    expect(extractJWT(c)).toBe(jwt);
  });

  it('extracts JWT from CF_Authorization cookie with other cookies', () => {
    const jwt = 'cookie.payload.signature';
    const c = createMockContext({
      cookies: `other=value; CF_Authorization=${jwt}; another=test`,
    });
    expect(extractJWT(c)).toBe(jwt);
  });

  it('prefers header over cookie', () => {
    const headerJwt = 'header.jwt.token';
    const cookieJwt = 'cookie.jwt.token';
    const c = createMockContext({
      jwtHeader: headerJwt,
      cookies: `CF_Authorization=${cookieJwt}`,
    });
    expect(extractJWT(c)).toBe(headerJwt);
  });

  it('returns null when no JWT present', () => {
    const c = createMockContext({});
    expect(extractJWT(c)).toBeNull();
  });

  it('returns null when cookie header exists but no CF_Authorization', () => {
    const c = createMockContext({ cookies: 'other=value; session=abc123' });
    expect(extractJWT(c)).toBeNull();
  });

  it('handles cookie with whitespace', () => {
    const jwt = 'spaced.payload.signature';
    const c = createMockContext({ cookies: `  CF_Authorization=${jwt}  ` });
    expect(extractJWT(c)).toBe(jwt);
  });
});

describe('isAuthServiceMode', () => {
  it('returns true when AUTH_SERVICE is set', () => {
    const mockFetcher = { fetch: vi.fn() } as unknown as Fetcher;
    const env = createMockEnv({ AUTH_SERVICE: mockFetcher });
    expect(isAuthServiceMode(env)).toBe(true);
  });

  it('returns false when AUTH_SERVICE is not set', () => {
    const env = createMockEnv();
    expect(isAuthServiceMode(env)).toBe(false);
  });
});

describe('validateWithAuthService', () => {
  function makeFetcher(body: unknown, status = 200): Fetcher {
    return {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status }),
      ),
    } as unknown as Fetcher;
  }

  it('returns null when cookie header is null', async () => {
    const fetcher = makeFetcher({ user: { email: 'u@example.com' } });
    expect(await validateWithAuthService(null, fetcher)).toBeNull();
  });

  it('returns null when no session cookie is present', async () => {
    const fetcher = makeFetcher({ user: { email: 'u@example.com' } });
    expect(await validateWithAuthService('other=value; session=abc', fetcher)).toBeNull();
  });

  it('accepts bare better-auth.session_token cookie', async () => {
    const fetcher = makeFetcher({ user: { email: 'user@example.com', name: 'User' } });
    const result = await validateWithAuthService('better-auth.session_token=tok123', fetcher);
    expect(result).toEqual({ email: 'user@example.com', name: 'User' });
  });

  it('accepts __Secure- prefixed better-auth.session_token cookie', async () => {
    const fetcher = makeFetcher({ user: { email: 'secure@example.com', name: 'Secure' } });
    const result = await validateWithAuthService('__Secure-better-auth.session_token=tok456', fetcher);
    expect(result).toEqual({ email: 'secure@example.com', name: 'Secure' });
  });

  it('returns null when auth service response is not ok', async () => {
    const fetcher = makeFetcher({ error: 'Unauthorized' }, 401);
    expect(await validateWithAuthService('better-auth.session_token=tok', fetcher)).toBeNull();
  });

  it('returns null when auth service returns no user', async () => {
    const fetcher = makeFetcher({ user: null });
    expect(await validateWithAuthService('better-auth.session_token=tok', fetcher)).toBeNull();
  });

  it('returns null when auth service throws', async () => {
    const fetcher = {
      fetch: vi.fn().mockRejectedValue(new Error('Network error')),
    } as unknown as Fetcher;
    expect(await validateWithAuthService('better-auth.session_token=tok', fetcher)).toBeNull();
  });
});

describe('createAccessMiddleware', () => {
  // Import the function dynamically to allow mocking
  let createAccessMiddleware: typeof import('./middleware').createAccessMiddleware;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./middleware');
    createAccessMiddleware = module.createAccessMiddleware;
  });

  // Helper to create a mock context with full implementation
  function createFullMockContext(options: {
    env?: Partial<OpenClawEnv>;
    jwtHeader?: string;
    cookies?: string;
    url?: string;
  }): {
    c: Context<AppEnv>;
    jsonMock: ReturnType<typeof vi.fn>;
    htmlMock: ReturnType<typeof vi.fn>;
    redirectMock: ReturnType<typeof vi.fn>;
    setMock: ReturnType<typeof vi.fn>;
  } {
    const headers = new Headers();
    if (options.jwtHeader) {
      headers.set('CF-Access-JWT-Assertion', options.jwtHeader);
    }
    if (options.cookies) {
      headers.set('Cookie', options.cookies);
    }

    const jsonMock = vi.fn().mockReturnValue(new Response());
    const htmlMock = vi.fn().mockReturnValue(new Response());
    const redirectMock = vi.fn().mockReturnValue(new Response());
    const setMock = vi.fn();

    const c = {
      req: {
        header: (name: string) => headers.get(name),
        raw: { headers },
        url: options.url ?? 'https://agent.pdx.software/',
      },
      env: createMockEnv(options.env),
      json: jsonMock,
      html: htmlMock,
      redirect: redirectMock,
      set: setMock,
    } as unknown as Context<AppEnv>;

    return { c, jsonMock, htmlMock, redirectMock, setMock };
  }

  it('skips auth and sets dev user when DEV_MODE is true', async () => {
    const { c, setMock } = createFullMockContext({ env: { DEV_MODE: 'true' } });
    const middleware = createAccessMiddleware({ type: 'json' });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith('accessUser', {
      email: 'dev@localhost',
      name: 'Dev User',
    });
  });

  it('skips auth and sets dev user when E2E_TEST_MODE is true', async () => {
    const { c, setMock } = createFullMockContext({ env: { E2E_TEST_MODE: 'true' } });
    const middleware = createAccessMiddleware({ type: 'json' });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith('accessUser', {
      email: 'dev@localhost',
      name: 'Dev User',
    });
  });

  it('returns 500 JSON error when CF Access not configured', async () => {
    const { c, jsonMock } = createFullMockContext({ env: {} });
    const middleware = createAccessMiddleware({ type: 'json' });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Cloudflare Access not configured' }),
      500,
    );
  });

  it('returns 500 HTML error when CF Access not configured', async () => {
    const { c, htmlMock } = createFullMockContext({ env: {} });
    const middleware = createAccessMiddleware({ type: 'html' });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(htmlMock).toHaveBeenCalledWith(expect.stringContaining('Admin UI Not Configured'), 500);
  });

  it('returns 401 JSON error when JWT is missing', async () => {
    const { c, jsonMock } = createFullMockContext({
      env: { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud123' },
    });
    const middleware = createAccessMiddleware({ type: 'json' });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }), 401);
  });

  it('returns 401 HTML error when JWT is missing', async () => {
    const { c, htmlMock } = createFullMockContext({
      env: { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud123' },
    });
    const middleware = createAccessMiddleware({ type: 'html' });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(htmlMock).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'), 401);
  });

  it('redirects when JWT is missing and redirectOnMissing is true', async () => {
    const { c, redirectMock } = createFullMockContext({
      env: { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud123' },
    });
    const middleware = createAccessMiddleware({ type: 'html', redirectOnMissing: true });
    const next = vi.fn();

    await middleware(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith('https://team.cloudflareaccess.com', 302);
  });

  // AUTH_SERVICE (better-auth) mode tests
  describe('AUTH_SERVICE mode', () => {
    function makeFetcherForUser(user: { email: string; name?: string } | null, status = 200): Fetcher {
      return {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ user }), { status }),
        ),
      } as unknown as Fetcher;
    }

    it('returns 401 JSON when no session cookie is present', async () => {
      const authService = makeFetcherForUser(null, 200);
      const { c, jsonMock } = createFullMockContext({
        env: { AUTH_SERVICE: authService },
        cookies: 'other=value',
      });
      const middleware = createAccessMiddleware({ type: 'json' });
      const next = vi.fn();

      await middleware(c, next);

      expect(next).not.toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }), 401);
    });

    it('redirects HTML requests to auth service login when no session cookie', async () => {
      const authService = makeFetcherForUser(null, 200);
      const { c, redirectMock } = createFullMockContext({
        env: { AUTH_SERVICE: authService },
        cookies: 'other=value',
        url: 'https://agent.pdx.software/admin/',
      });
      const middleware = createAccessMiddleware({ type: 'html' });
      const next = vi.fn();

      await middleware(c, next);

      expect(next).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(
        `https://auth.pdx.software/login?redirect=${encodeURIComponent('https://agent.pdx.software/admin/')}`,
      );
    });

    it('uses WORKER_URL as trusted origin in redirect when set', async () => {
      const authService = makeFetcherForUser(null, 200);
      const { c, redirectMock } = createFullMockContext({
        env: { AUTH_SERVICE: authService, WORKER_URL: 'https://trusted.example.com' },
        cookies: 'other=value',
        url: 'https://workers-dev-hostname.workers.dev/some/path?q=1',
      });
      const middleware = createAccessMiddleware({ type: 'html' });
      const next = vi.fn();

      await middleware(c, next);

      expect(next).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(
        `https://auth.pdx.software/login?redirect=${encodeURIComponent('https://trusted.example.com/some/path?q=1')}`,
      );
    });

    it('accepts bare better-auth.session_token and calls next with user', async () => {
      const authService = makeFetcherForUser({ email: 'user@example.com', name: 'User' });
      const { c, setMock } = createFullMockContext({
        env: { AUTH_SERVICE: authService },
        cookies: 'better-auth.session_token=tok123',
      });
      const middleware = createAccessMiddleware({ type: 'json' });
      const next = vi.fn();

      await middleware(c, next);

      expect(next).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith('accessUser', { email: 'user@example.com', name: 'User' });
    });

    it('accepts __Secure- prefixed session cookie and calls next with user', async () => {
      const authService = makeFetcherForUser({ email: 'secure@example.com' });
      const { c, setMock } = createFullMockContext({
        env: { AUTH_SERVICE: authService },
        cookies: '__Secure-better-auth.session_token=tok456',
      });
      const middleware = createAccessMiddleware({ type: 'json' });
      const next = vi.fn();

      await middleware(c, next);

      expect(next).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith('accessUser', { email: 'secure@example.com', name: undefined });
    });
  });
});
