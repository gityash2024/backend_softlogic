import express from 'express';
import request from 'supertest';
import { UserRole } from '@prisma/client';

import {
  authMiddleware,
  authMiddlewareAllowMissingClientSession,
} from '@/shared/middleware/auth.middleware';
import { generateAccessToken } from '@/shared/utils/jwt';
import { authRepository } from '@/modules/auth/auth.repository';
import { errorMiddleware } from '@/shared/middleware/error.middleware';

jest.mock('@/modules/auth/auth.repository', () => ({
  authRepository: {
    findUserSessionByClientSessionId: jest.fn(),
  },
}));

const mockedAuthRepository = jest.mocked(authRepository);

const app = express();
app.get('/strict', authMiddleware, (_req, res) => res.json({ ok: true }));
app.get('/repair', authMiddlewareAllowMissingClientSession, (_req, res) =>
  res.json({ ok: true }),
);
app.use(errorMiddleware);

const accessToken = generateAccessToken({
  userId: 'user-1',
  email: 'teacher@softlogicwhiteboard.com',
  role: UserRole.TEACHER,
  organizationId: 'org-1',
});

describe('authMiddleware client session enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a valid access token when the client session was revoked', async () => {
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      clientSessionId: 'web-session-1',
      revokedAt: new Date('2026-06-05T00:00:00.000Z'),
      expiresAt: new Date('2026-06-12T00:00:00.000Z'),
    } as never);

    const response = await request(app)
      .get('/strict')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-SoftLogic-Client-Session-Id', 'web-session-1');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid token');
  });

  it('allows session repair endpoints when the client session row is missing', async () => {
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue(null);

    const response = await request(app)
      .get('/repair')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-SoftLogic-Client-Session-Id', 'web-session-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects normal protected endpoints when the client session row is missing', async () => {
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue(null);

    const response = await request(app)
      .get('/strict')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-SoftLogic-Client-Session-Id', 'web-session-1');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid token');
  });
});
