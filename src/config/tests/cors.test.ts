import request from 'supertest';

import { createApp } from '@/app';

describe('CORS', () => {
  const app = createApp();

  it('allows the local Vite admin panel to preflight admin auth requests', async () => {
    const response = await request(app)
      .options('/api/v1/auth/admin/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(
      response.headers['access-control-allow-headers'].toLowerCase(),
    ).toContain('content-type');
  });

  it('allows the deployed admin panel to preflight admin auth requests', async () => {
    const response = await request(app)
      .options('/api/v1/auth/admin/login')
      .set('Origin', 'https://adminpanelsoftlogic.vercel.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://adminpanelsoftlogic.vercel.app',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
