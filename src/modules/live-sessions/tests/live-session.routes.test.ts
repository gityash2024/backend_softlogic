import request from 'supertest';
import { UserRole } from '@prisma/client';

import { createApp } from '@/app';
import { liveSessionService } from '@/modules/live-sessions/live-session.service';

jest.mock('@/shared/middleware/auth.middleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const role = req.headers['x-test-role'] ?? UserRole.TEACHER;
    req.user = {
      userId: req.headers['x-test-user-id'] ?? 'teacher-1',
      email: req.headers['x-test-email'] ?? 'teacher@example.com',
      role,
      organizationId: 'org-1',
    };
    next();
  },
  authMiddlewareAllowMissingClientSession: (req: any, _res: any, next: any) => {
    const role = req.headers['x-test-role'] ?? UserRole.TEACHER;
    req.user = {
      userId: req.headers['x-test-user-id'] ?? 'teacher-1',
      email: req.headers['x-test-email'] ?? 'teacher@example.com',
      role,
      organizationId: 'org-1',
    };
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      userId: req.headers['x-test-user-id'] ?? 'teacher-1',
      email: req.headers['x-test-email'] ?? 'teacher@example.com',
      role: req.headers['x-test-role'] ?? UserRole.TEACHER,
      organizationId: 'org-1',
    };
    next();
  },
  roleGuard: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('@/modules/live-sessions/live-session.service', () => ({
  liveSessionService: {
    listSessions: jest.fn(),
    createSession: jest.fn(),
    getSession: jest.fn(),
    startSession: jest.fn(),
    endSession: jest.fn(),
    generateSessionJoinCode: jest.fn(),
    inviteStudent: jest.fn(),
    verifyJoinCode: jest.fn(),
    joinByCode: jest.fn(),
    listMessages: jest.fn(),
    sendMessage: jest.fn(),
    createMediaAsset: jest.fn(),
    createRecording: jest.fn(),
    createShareUrl: jest.fn(),
    createCallToken: jest.fn(),
    ensureSessionAccess: jest.fn(),
  },
}));

const mockedLiveSessionService = liveSessionService as jest.Mocked<
  typeof liveSessionService
>;

const sessionId = '8d216bb1-8e70-46c1-a9ef-4cd5922ec2c1';
const canvasId = 'd5fc3c87-55d6-4b7b-9960-3fb19e98368b';

describe('Live session routes', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a live session for a teacher', async () => {
    mockedLiveSessionService.createSession.mockResolvedValue({
      id: sessionId,
      canvasId,
      title: 'Math Class',
      status: 'SCHEDULED',
    } as never);

    const response = await request(app)
      .post('/api/v1/live-sessions')
      .send({ canvasId, title: 'Math Class' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockedLiveSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.TEACHER }),
      expect.objectContaining({ canvasId, title: 'Math Class' }),
    );
  });

  it('lists only sessions from the service role scope', async () => {
    mockedLiveSessionService.listSessions.mockResolvedValue([
      {
        id: sessionId,
        canvasId,
        title: 'Math Class',
        status: 'LIVE',
      },
    ] as never);

    const response = await request(app)
      .get('/api/v1/live-sessions')
      .query({ status: 'LIVE' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(mockedLiveSessionService.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.TEACHER }),
      { status: 'LIVE' },
    );
  });

  it('sends student invite emails through the invite endpoint', async () => {
    mockedLiveSessionService.inviteStudent.mockResolvedValue({
      id: 'invite-1',
      email: 'student@example.com',
      codeExpiresAt: new Date('2026-04-28T12:00:00.000Z'),
      downloadPageUrl: 'https://example.com/download',
    } as never);

    const response = await request(app)
      .post(`/api/v1/live-sessions/${sessionId}/invites`)
      .send({ email: 'student@example.com' });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe('student@example.com');
    expect(mockedLiveSessionService.inviteStudent).toHaveBeenCalledWith(
      expect.any(Object),
      sessionId,
      expect.objectContaining({ email: 'student@example.com' }),
    );
  });

  it('generates a teacher session code', async () => {
    mockedLiveSessionService.generateSessionJoinCode.mockResolvedValue({
      liveSessionId: sessionId,
      canvasId,
      title: 'Math Class',
      code: 'ABC123',
      expiresAt: new Date('2026-04-28T12:00:00.000Z'),
    } as never);

    const response = await request(app)
      .post(`/api/v1/live-sessions/${sessionId}/join-code`)
      .send({ expiresInMinutes: 30 });

    expect(response.status).toBe(200);
    expect(response.body.data.code).toBe('ABC123');
    expect(mockedLiveSessionService.generateSessionJoinCode).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.TEACHER }),
      sessionId,
      expect.objectContaining({ expiresInMinutes: 30 }),
    );
  });

  it('verifies and joins with a session code', async () => {
    mockedLiveSessionService.verifyJoinCode.mockResolvedValue({
      liveSessionId: sessionId,
      canvasId,
      title: 'Math Class',
      email: 'student@example.com',
      expiresAt: new Date('2026-04-28T12:00:00.000Z'),
    } as never);
    mockedLiveSessionService.joinByCode.mockResolvedValue({
      liveSession: { id: sessionId, canvasId, title: 'Math Class' },
      participant: { id: 'participant-1' },
    } as never);

    const verifyResponse = await request(app)
      .post('/api/v1/live-sessions/join-code/verify')
      .send({ code: 'ABC123' });
    const joinResponse = await request(app)
      .post('/api/v1/live-sessions/join-code/join')
      .set('x-test-role', UserRole.STUDENT)
      .set('x-test-email', 'student@example.com')
      .send({ code: 'ABC123' });

    expect(verifyResponse.status).toBe(200);
    expect(joinResponse.status).toBe(200);
    expect(mockedLiveSessionService.verifyJoinCode).toHaveBeenCalledWith('ABC123');
    expect(mockedLiveSessionService.joinByCode).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.STUDENT }),
      'ABC123',
    );
  });

  it('persists chat messages and returns LiveKit call token payloads', async () => {
    mockedLiveSessionService.sendMessage.mockResolvedValue({
      id: 'message-1',
      body: 'Hello',
      type: 'TEXT',
    } as never);
    mockedLiveSessionService.ensureSessionAccess.mockResolvedValue({ id: sessionId } as never);
    mockedLiveSessionService.createCallToken.mockResolvedValue({
      provider: 'livekit',
      livekitUrl: 'wss://example.livekit.cloud',
      token: 'token',
      iceServers: [],
    } as never);

    const messageResponse = await request(app)
      .post(`/api/v1/live-sessions/${sessionId}/messages`)
      .send({ type: 'TEXT', body: 'Hello' });
    const tokenResponse = await request(app).post(
      `/api/v1/live-sessions/${sessionId}/call-token`,
    );

    expect(messageResponse.status).toBe(201);
    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.body.data.provider).toBe('livekit');
  });

  it('rejects invalid message payloads before reaching the service', async () => {
    const response = await request(app)
      .post(`/api/v1/live-sessions/${sessionId}/messages`)
      .send({ type: 'TEXT' });

    expect(response.status).toBe(400);
    expect(mockedLiveSessionService.sendMessage).not.toHaveBeenCalled();
  });
});
