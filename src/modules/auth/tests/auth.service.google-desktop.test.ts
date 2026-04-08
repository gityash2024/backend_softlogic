import { GoogleDesktopAuthAttemptStatus, UserRole, UserStatus } from '@prisma/client';

jest.mock('@/config', () => ({
  env: {
    DEV_FIXED_OTP_ALLOWED_EMAILS: '',
    DEV_FIXED_OTP_CODE: '1234',
    DEV_FIXED_OTP_ENABLED: false,
    GOOGLE_CLIENT_ID: 'desktop-google-client-id',
    GOOGLE_CLIENT_SECRET: 'desktop-google-client-secret',
    GOOGLE_OAUTH_REDIRECT_URI:
      'https://softlogic-whiteboard-backend.example.com/api/v1/auth/google/desktop/callback',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_ACCESS_SECRET: '12345678901234567890123456789012',
    JWT_REFRESH_EXPIRES_IN: '7d',
    JWT_REFRESH_SECRET: '12345678901234567890123456789012-refresh',
    NODE_ENV: 'test',
    TESTING_RELAX_AUTH_LIMITS: true,
  },
}));

jest.mock('@/modules/auth/auth.repository', () => ({
  authRepository: {
    consumeGoogleDesktopAuthAttempt: jest.fn(),
    countRecentOtps: jest.fn(),
    createGoogleDesktopAuthAttempt: jest.fn(),
    createOtp: jest.fn(),
    createSession: jest.fn(),
    deleteSessionByToken: jest.fn(),
    findGoogleDesktopAuthAttemptById: jest.fn(),
    findGoogleDesktopAuthAttemptByState: jest.fn(),
    findLatestOtp: jest.fn(),
    findSessionByToken: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserByGoogleId: jest.fn(),
    findUserById: jest.fn(),
    incrementOtpAttempts: jest.fn(),
    invalidateUserOtps: jest.fn(),
    markOtpUsed: jest.fn(),
    updateGoogleDesktopAuthAttempt: jest.fn(),
    updateUser: jest.fn(),
  },
}));

jest.mock('@/modules/users/user-context.service', () => ({
  findUserContextById: jest.fn(),
}));

jest.mock('@/modules/auth/strategies/google.strategy', () => ({
  googleStrategy: {
    verifyIdToken: jest.fn(),
  },
}));

jest.mock('@/shared/utils/jwt', () => ({
  generateTokenPair: jest.fn(),
  verifyRefreshToken: jest.fn(),
}));

import { authRepository } from '@/modules/auth/auth.repository';
import { authService } from '@/modules/auth/auth.service';

const mockedAuthRepository = jest.mocked(authRepository);

const safeUserContext = {
  id: 'user-1',
  email: 'teacher@softlogicwhiteboard.com',
  name: 'Teacher Demo',
  avatar: 'https://example.com/avatar.png',
  role: UserRole.TEACHER,
  status: UserStatus.ACTIVE,
  isEmailVerified: true,
  timezone: 'Asia/Kolkata',
  language: 'en',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  invitedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
  primaryOrganization: null,
  organizations: [],
  subscription: null,
};

const completedSession = {
  tokens: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  },
  user: safeUserContext,
};

describe('AuthService desktop Google sign-in', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      value: jest.fn(),
      writable: true,
    });
  });

  it('starts a desktop Google OAuth attempt with a browser URL', async () => {
    mockedAuthRepository.createGoogleDesktopAuthAttempt.mockResolvedValue({
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      expiresAt: new Date('2026-04-07T10:10:00.000Z'),
      id: 'attempt-1',
      state: 'state-1',
      status: GoogleDesktopAuthAttemptStatus.PENDING,
      updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    } as any);

    const result = await authService.startDesktopGoogleSignIn();

    expect(result.attemptId).toBe('attempt-1');
    expect(result.pollIntervalMs).toBe(2000);
    expect(result.authUrl).toContain('state=state-1');
    expect(result.authUrl).toContain('redirect_uri=');
    expect(mockedAuthRepository.createGoogleDesktopAuthAttempt).toHaveBeenCalled();
  });

  it('completes the callback, stores the session, and renders success HTML', async () => {
    mockedAuthRepository.findGoogleDesktopAuthAttemptByState.mockResolvedValue({
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      id: 'attempt-1',
      state: 'state-1',
      status: GoogleDesktopAuthAttemptStatus.PENDING,
      updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    } as any);
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ id_token: 'google-id-token' }),
      ok: true,
    });

    const googleSignInSpy = jest
      .spyOn(authService, 'googleSignIn')
      .mockResolvedValue(completedSession as any);

    const result = await authService.handleDesktopGoogleCallback({
      code: 'oauth-code',
      ipAddress: '127.0.0.1',
      state: 'state-1',
    });

    expect(result.statusCode).toBe(200);
    expect(result.html).toContain('data:image/png;base64,');
    expect(result.html).toContain('You are signed in');
    expect(result.html).toContain('You may now close this page.');
    expect(result.html).not.toContain('Return to the SoftLogic desktop app.');
    expect(result.html).not.toContain('You can close this tab.');
    expect(googleSignInSpy).toHaveBeenCalledWith('google-id-token', '127.0.0.1');
    expect(mockedAuthRepository.updateGoogleDesktopAuthAttempt).toHaveBeenCalledWith(
      'attempt-1',
      expect.objectContaining({
        status: GoogleDesktopAuthAttemptStatus.COMPLETED,
      }),
    );
  });

  it('marks expired attempts as expired while polling status', async () => {
    mockedAuthRepository.findGoogleDesktopAuthAttemptById.mockResolvedValue({
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      expiresAt: new Date(Date.now() - 5 * 60 * 1000),
      id: 'attempt-1',
      state: 'state-1',
      status: GoogleDesktopAuthAttemptStatus.PENDING,
      updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    } as any);
    mockedAuthRepository.updateGoogleDesktopAuthAttempt.mockResolvedValue({
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      errorMessage: 'Google sign-in session expired. Please try again.',
      expiresAt: new Date(Date.now() - 5 * 60 * 1000),
      id: 'attempt-1',
      state: 'state-1',
      status: GoogleDesktopAuthAttemptStatus.EXPIRED,
      updatedAt: new Date(),
    } as any);

    const result = await authService.getDesktopGoogleSignInStatus('attempt-1');

    expect(result.status).toBe('expired');
    expect(mockedAuthRepository.updateGoogleDesktopAuthAttempt).toHaveBeenCalledWith(
      'attempt-1',
      expect.objectContaining({
        status: GoogleDesktopAuthAttemptStatus.EXPIRED,
      }),
    );
  });

  it('returns the stored session once and consumes the completed attempt', async () => {
    mockedAuthRepository.findGoogleDesktopAuthAttemptById.mockResolvedValue({
      consumedAt: null,
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      id: 'attempt-1',
      sessionPayload: JSON.parse(JSON.stringify(completedSession)),
      state: 'state-1',
      status: GoogleDesktopAuthAttemptStatus.COMPLETED,
      updatedAt: new Date('2026-04-07T10:00:00.000Z'),
    } as any);
    mockedAuthRepository.consumeGoogleDesktopAuthAttempt.mockResolvedValue(true);

    const result = await authService.getDesktopGoogleSignInStatus('attempt-1');

    expect(result.status).toBe('completed');
    expect(result.session?.tokens.accessToken).toBe('access-token');
    expect(mockedAuthRepository.consumeGoogleDesktopAuthAttempt).toHaveBeenCalledWith(
      'attempt-1',
      expect.any(Date),
    );
  });

  it('renders a failure page when the callback state is invalid', async () => {
    mockedAuthRepository.findGoogleDesktopAuthAttemptByState.mockResolvedValue(null);

    const result = await authService.handleDesktopGoogleCallback({
      code: 'oauth-code',
      state: 'missing-state',
    });

    expect(result.statusCode).toBe(404);
    expect(result.html).toContain('We could not find this sign-in request');
    expect(result.html).not.toContain('Return to the SoftLogic desktop app.');
    expect(result.html).not.toContain('Start Google sign-in again.');
    expect(mockedAuthRepository.updateGoogleDesktopAuthAttempt).not.toHaveBeenCalled();
  });
});
