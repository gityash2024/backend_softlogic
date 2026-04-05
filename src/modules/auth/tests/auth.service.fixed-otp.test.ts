import { OtpType, UserRole, UserStatus } from '@prisma/client';

import { env } from '@/config';
import { AuthError } from '@/shared/errors/AuthError';

jest.mock('@/modules/auth/auth.repository', () => ({
  authRepository: {
    findUserByEmail: jest.fn(),
    findLatestOtp: jest.fn(),
    incrementOtpAttempts: jest.fn(),
    markOtpUsed: jest.fn(),
    updateUser: jest.fn(),
    findUserById: jest.fn(),
    createSession: jest.fn(),
  },
}));

jest.mock('@/modules/users/user-context.service', () => ({
  findUserContextById: jest.fn(),
}));

jest.mock('@/shared/utils/jwt', () => ({
  generateTokenPair: jest.fn(),
  verifyRefreshToken: jest.fn(),
}));

jest.mock('@/shared/utils/otp', () => ({
  generateOtp: jest.fn(),
  hashOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

import { authRepository } from '@/modules/auth/auth.repository';
import { authService } from '@/modules/auth/auth.service';
import { findUserContextById } from '@/modules/users/user-context.service';
import { generateTokenPair } from '@/shared/utils/jwt';
import { verifyOtp as verifyOtpHash } from '@/shared/utils/otp';

const mockedAuthRepository = jest.mocked(authRepository);
const mockedFindUserContextById = jest.mocked(findUserContextById);
const mockedGenerateTokenPair = jest.mocked(generateTokenPair);
const mockedVerifyOtpHash = jest.mocked(verifyOtpHash);

const activeUser = {
  id: 'user-1',
  email: 'admin@softlogicwhiteboard.com',
  name: 'Admin User',
  avatar: null,
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  timezone: 'Asia/Kolkata',
  language: 'en',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  invitedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  lastLoginAt: null,
  googleId: null,
  isEmailVerified: true,
  primaryOrganizationId: null,
};

const activeOtp = {
  id: 'otp-1',
  userId: 'user-1',
  code: 'hashed-otp',
  type: OtpType.EMAIL_LOGIN,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  usedAt: null,
  attempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const safeUserContext = {
  id: 'user-1',
  email: 'admin@softlogicwhiteboard.com',
  name: 'Admin User',
  avatar: null,
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  isEmailVerified: true,
  timezone: 'Asia/Kolkata',
  language: 'en',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  invitedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastLoginAt: null,
  primaryOrganization: null,
  organizations: [],
  subscription: null,
};

describe('AuthService fixed OTP allowlist', () => {
  const originalEnv = {
    NODE_ENV: env.NODE_ENV,
    DEV_FIXED_OTP_ENABLED: env.DEV_FIXED_OTP_ENABLED,
    DEV_FIXED_OTP_CODE: env.DEV_FIXED_OTP_CODE,
    DEV_FIXED_OTP_ALLOWED_EMAILS: env.DEV_FIXED_OTP_ALLOWED_EMAILS,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    env.NODE_ENV = 'production';
    env.DEV_FIXED_OTP_ENABLED = true;
    env.DEV_FIXED_OTP_CODE = '1234';
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = 'admin@softlogicwhiteboard.com';

    mockedAuthRepository.findUserByEmail.mockResolvedValue(activeUser as any);
    mockedAuthRepository.findLatestOtp.mockResolvedValue(activeOtp as any);
    mockedAuthRepository.markOtpUsed.mockResolvedValue({} as any);
    mockedAuthRepository.updateUser.mockResolvedValue({} as any);
    mockedAuthRepository.findUserById.mockResolvedValue(activeUser as any);
    mockedAuthRepository.createSession.mockResolvedValue({} as any);
    mockedFindUserContextById.mockResolvedValue(safeUserContext as any);
    mockedGenerateTokenPair.mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    mockedVerifyOtpHash.mockResolvedValue(false);
  });

  afterAll(() => {
    env.NODE_ENV = originalEnv.NODE_ENV;
    env.DEV_FIXED_OTP_ENABLED = originalEnv.DEV_FIXED_OTP_ENABLED;
    env.DEV_FIXED_OTP_CODE = originalEnv.DEV_FIXED_OTP_CODE;
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = originalEnv.DEV_FIXED_OTP_ALLOWED_EMAILS;
  });

  it('accepts 1234 for an allowlisted production email with an active OTP request', async () => {
    const result = await authService.verifyOtp(
      'admin@softlogicwhiteboard.com',
      '1234',
      '127.0.0.1',
    );

    expect(result.tokens.accessToken).toBe('access-token');
    expect(mockedAuthRepository.markOtpUsed).toHaveBeenCalledWith('otp-1');
    expect(mockedVerifyOtpHash).not.toHaveBeenCalled();
  });

  it('rejects 1234 for a non-allowlisted production email', async () => {
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = 'qa@softlogicwhiteboard.com';

    await expect(
      authService.verifyOtp('admin@softlogicwhiteboard.com', '1234'),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedVerifyOtpHash).toHaveBeenCalledWith('1234', 'hashed-otp');
    expect(mockedAuthRepository.incrementOtpAttempts).toHaveBeenCalledWith('otp-1');
  });

  it('still requires an existing OTP record for allowlisted emails', async () => {
    mockedAuthRepository.findLatestOtp.mockResolvedValue(null);

    await expect(
      authService.verifyOtp('admin@softlogicwhiteboard.com', '1234'),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedAuthRepository.markOtpUsed).not.toHaveBeenCalled();
  });
});
