import { test, expect } from '@playwright/test';

/**
 * Basic sanity checks for public health endpoints.
 * These endpoints require no authentication and no sandbox container.
 */
test.describe('Health endpoints', () => {
  test('GET /sandbox-health returns status ok', async ({ request }) => {
    const response = await request.get('/sandbox-health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    // The endpoint also includes service and gateway_port fields
    expect(body.service).toBe('openclaw-sandbox');
  });

  test('GET /api/status returns JSON with an ok field', async ({ request }) => {
    const response = await request.get('/api/status');
    expect(response.status()).toBe(200);

    const body = await response.json();
    // ok is a boolean — the sandbox container is not running locally,
    // so we only assert the field exists and is a boolean.
    expect(typeof body.ok).toBe('boolean');
  });
});
