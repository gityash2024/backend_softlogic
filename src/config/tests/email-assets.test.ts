import request from 'supertest';

import { createApp } from '@/app';

describe('email assets', () => {
  const app = createApp();

  it.each([
    '/email-assets/softlogic-logo.png',
    '/api/email-assets/softlogic-logo.png',
    '/api/v1/email-assets/softlogic-logo.png',
  ])('serves the SoftLogic logo as a public PNG asset from %s', async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.body.length).toBeGreaterThan(0);
  });
});
