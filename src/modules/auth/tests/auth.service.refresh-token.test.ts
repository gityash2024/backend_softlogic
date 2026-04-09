jest.mock('@/config', () => ({
  env: {
    DEV_FIXED_OTP_ALLOWED_EMAILS: '',
    DEV_FIXED_OTP_CODE: '1234',
    DEV_FIXED_OTP_ENABLED: false,
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_ACCESS_SECRET: '12345678901234567890123456789012',
    JWT_REFRESH_EXPIRES_IN: '7d',
    JWT_REFRESH_SECRET: '12345678901234567890123456789012-refresh',
    NODE_ENV: 'test',
    TESTING_RELAX_AUTH_LIMITS: true,
  },
}));

import { UserRole, UserStatus } from '@prisma/client';

jest.mock('@/modules/auth/auth.repository', () => ({
  authRepository: {
    createSession: jest.fn(),
    deleteSession: jest.fn(),
    findSessionByToken: jest.fn(),
    findUserById: jest.fn(),
  },
}));

jest.mock('@/modules/users/user-context.service', () => ({
  findUserContextById: jest.fn(),
}));

jest.mock('@/shared/utils/jwt', () => ({
  generateTokenPair: jest.fn(),
  verifyRefreshToken: jest.fn(),
}));

import { authRepository } from '@/modules/auth/auth.repository';
import { authService } from '@/modules/auth/auth.service';
import { findUserContextById } from '@/modules/users/user-context.service';
import { generateTokenPair, verifyRefreshToken } from '@/shared/utils/jwt';

const mockedAuthRepository = jest.mocked(authRepository);
const mockedFindUserContextById = jest.mocked(findUserContextById);
const mockedGenerateTokenPair = jest.mocked(generateTokenPair);
const mockedVerifyRefreshToken = jest.mocked(verifyRefreshToken);

describe('AuthService refresh token', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedAuthRepository.findUserById.mockResolvedValue({
      id: 'user-1',
      email: 'student@softlogicwhiteboard.com',
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      primaryOrganizationId: null,
    } as any);
    mockedGenerateTokenPair.mockReturnValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    mockedFindUserContextById.mockResolvedValue({
      id: 'user-1',
      email: 'student@softlogicwhiteboard.com',
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
      timezone: 'UTC',
      language: 'en',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      primaryOrganization: null,
      organizations: [],
      subscription: null,
      name: 'Student Demo',
      avatar: null,
    } as any);
    mockedAuthRepository.createSession.mockResolvedValue({} as any);
  });

  it('keeps the session alive in testing mode even when the refresh JWT is invalid', async () => {
    mockedAuthRepository.findSessionByToken.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      refreshToken: 'expired-refresh-token',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    } as any);
    mockedVerifyRefreshToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const result = await authService.refreshToken('expired-refresh-token');

    expect(result.tokens.accessToken).toBe('new-access-token');
    expect(mockedAuthRepository.findUserById).toHaveBeenCalledWith('user-1');
    expect(mockedAuthRepository.deleteSession).toHaveBeenCalledWith('session-1');
    expect(mockedAuthRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'new-refresh-token',
        userId: 'user-1',
      }),
    );
  });

  it('still rejects refresh when there is no persisted session row', async () => {
    mockedAuthRepository.findSessionByToken.mockResolvedValue(null);
    mockedVerifyRefreshToken.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    await expect(
      authService.refreshToken('missing-refresh-token'),
    ).rejects.toMatchObject({
      message: 'Invalid token',
      statusCode: 401,
    });

    expect(mockedAuthRepository.createSession).not.toHaveBeenCalled();
  });
});
