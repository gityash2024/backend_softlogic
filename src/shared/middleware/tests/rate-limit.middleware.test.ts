import express from 'express';
import request from 'supertest';

const loadLimiters = async (nodeEnv: 'development' | 'production') => {
  jest.resetModules();
  jest.doMock('@/config', () => ({
    env: {
      NODE_ENV: nodeEnv,
      TESTING_RELAX_AUTH_LIMITS: false,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX_REQUESTS: 2,
    },
  }));

  return import('@/shared/middleware/rate-limit.middleware');
};

const createTestApp = (...handlers: express.RequestHandler[]) => {
  const app = express();
  app.use(express.json());
  app.get('/probe', ...handlers, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
};

describe('rate-limit middleware environment behavior', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@/config');
  });

  it('bypasses global and auth limiters in development', async () => {
    const { authRateLimiter, globalRateLimiter } = await loadLimiters('development');
    const app = createTestApp(globalRateLimiter, authRateLimiter);

    for (let index = 0; index < 12; index += 1) {
      const response = await request(app).get('/probe');
      expect(response.status).toBe(200);
    }
  });

  it('keeps global and auth limiters active in production', async () => {
    const { authRateLimiter, globalRateLimiter } = await loadLimiters('production');
    const globalApp = createTestApp(globalRateLimiter);

    await expect(request(globalApp).get('/probe')).resolves.toHaveProperty('status', 200);
    await expect(request(globalApp).get('/probe')).resolves.toHaveProperty('status', 200);
    await expect(request(globalApp).get('/probe')).resolves.toHaveProperty('status', 429);

    const authApp = createTestApp(authRateLimiter);
    for (let index = 0; index < 10; index += 1) {
      const response = await request(authApp).get('/probe');
      expect(response.status).toBe(200);
    }
    const blocked = await request(authApp).get('/probe');
    expect(blocked.status).toBe(429);
  });
});
