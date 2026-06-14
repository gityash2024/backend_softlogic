import request from 'supertest';

import { createApp } from '@/app';

describe('email assets', () => {
  const app = createApp();

  it('serves the SoftLogic logo as a public PNG asset', async () => {
    const response = await request(app).get('/email-assets/softlogic-logo.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.body.length).toBeGreaterThan(0);
  });
});
