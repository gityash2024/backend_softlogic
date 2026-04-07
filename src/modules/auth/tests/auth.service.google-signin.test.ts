import { UserRole, UserStatus } from '@prisma/client';

jest.mock('@/modules/auth/auth.repository', () => ({
  authRepository: {
    createSession: jest.fn(),
    createUser: jest.fn(),
    deleteSession: jest.fn(),
    findSessionByToken: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserByGoogleId: jest.fn(),
    findUserById: jest.fn(),
    updateUser: jest.fn(),
  },
}));

jest.mock('@/modules/auth/strategies/google.strategy', () => ({
  googleStrategy: {
    verifyIdToken: jest.fn(),
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
import { googleStrategy } from '@/modules/auth/strategies/google.strategy';
import { findUserContextById } from '@/modules/users/user-context.service';
import { generateTokenPair } from '@/shared/utils/jwt';

const mockedAuthRepository = jest.mocked(authRepository);
const mockedGoogleStrategy = jest.mocked(googleStrategy);
const mockedFindUserContextById = jest.mocked(findUserContextById);
const mockedGenerateTokenPair = jest.mocked(generateTokenPair);

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

describe('AuthService Google Sign-In', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGoogleStrategy.verifyIdToken.mockResolvedValue({
      email: 'teacher@softlogicwhiteboard.com',
      name: 'Teacher Demo',
      picture: 'https://example.com/avatar.png',
      sub: 'google-sub-1',
    });
    mockedGenerateTokenPair.mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    mockedFindUserContextById.mockResolvedValue(safeUserContext as any);
    mockedAuthRepository.createSession.mockResolvedValue({} as any);
  });

  it('links an existing email user to the Google account and creates a session', async () => {
    mockedAuthRepository.findUserByGoogleId.mockResolvedValue(null);
    mockedAuthRepository.findUserByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@softlogicwhiteboard.com',
      name: null,
      avatar: null,
      googleId: null,
      isEmailVerified: false,
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      timezone: 'UTC',
      language: 'en',
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      lastLoginAt: null,
      primaryOrganizationId: null,
    } as any);
    mockedAuthRepository.updateUser.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@softlogicwhiteboard.com',
      name: 'Teacher Demo',
      avatar: 'https://example.com/avatar.png',
      googleId: 'google-sub-1',
      isEmailVerified: true,
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      timezone: 'UTC',
      language: 'en',
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      lastLoginAt: new Date(),
      primaryOrganizationId: null,
    } as any);

    const result = await authService.googleSignIn('google-id-token', '127.0.0.1');

    expect(result.tokens.accessToken).toBe('access-token');
    expect(mockedAuthRepository.updateUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        googleId: 'google-sub-1',
        isEmailVerified: true,
      }),
    );
    expect(mockedAuthRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        refreshToken: 'refresh-token',
        ipAddress: '127.0.0.1',
      }),
    );
  });

  it('creates a new user when the Google account email does not exist yet', async () => {
    mockedAuthRepository.findUserByGoogleId.mockResolvedValue(null);
    mockedAuthRepository.findUserByEmail.mockResolvedValue(null);
    mockedAuthRepository.createUser.mockResolvedValue({
      id: 'user-2',
      email: 'teacher@softlogicwhiteboard.com',
      name: 'Teacher Demo',
      avatar: 'https://example.com/avatar.png',
      googleId: 'google-sub-1',
      isEmailVerified: true,
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      timezone: 'UTC',
      language: 'en',
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      lastLoginAt: new Date(),
      primaryOrganizationId: null,
    } as any);
    mockedFindUserContextById.mockResolvedValue({
      ...safeUserContext,
      id: 'user-2',
    } as any);

    const result = await authService.googleSignIn('google-id-token');

    expect(result.user.id).toBe('user-2');
    expect(mockedAuthRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'teacher@softlogicwhiteboard.com',
        googleId: 'google-sub-1',
        isEmailVerified: true,
      }),
    );
  });

  it('reuses an existing Google-linked user and refreshes profile metadata', async () => {
    mockedAuthRepository.findUserByGoogleId.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@softlogicwhiteboard.com',
      name: 'Existing Name',
      avatar: null,
      googleId: 'google-sub-1',
      isEmailVerified: true,
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      timezone: 'UTC',
      language: 'en',
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      lastLoginAt: null,
      primaryOrganizationId: null,
    } as any);
    mockedAuthRepository.updateUser.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@softlogicwhiteboard.com',
      name: 'Existing Name',
      avatar: 'https://example.com/avatar.png',
      googleId: 'google-sub-1',
      isEmailVerified: true,
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      timezone: 'UTC',
      language: 'en',
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      lastLoginAt: new Date(),
      primaryOrganizationId: null,
    } as any);

    await authService.googleSignIn('google-id-token');

    expect(mockedAuthRepository.findUserByEmail).not.toHaveBeenCalled();
    expect(mockedAuthRepository.updateUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        avatar: 'https://example.com/avatar.png',
        isEmailVerified: true,
      }),
    );
  });
});
