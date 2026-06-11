jest.mock("@/config", () => ({
  env: {
    DEV_FIXED_OTP_ALLOWED_EMAILS: "",
    DEV_FIXED_OTP_CODE: "1234",
    DEV_FIXED_OTP_ENABLED: false,
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_ACCESS_SECRET: "12345678901234567890123456789012",
    JWT_REFRESH_EXPIRES_IN: "7d",
    JWT_REFRESH_SECRET: "12345678901234567890123456789012-refresh",
    NODE_ENV: "test",
    TESTING_RELAX_AUTH_LIMITS: true,
  },
}));

import { UserRole, UserStatus } from "@prisma/client";

jest.mock("@/modules/auth/auth.repository", () => ({
  authRepository: {
    createSession: jest.fn(),
    deleteSession: jest.fn(),
    findSessionByToken: jest.fn(),
    findUserSessionByClientSessionId: jest.fn(),
    findUserById: jest.fn(),
    updateSession: jest.fn(),
  },
}));

jest.mock("@/modules/users/user-context.service", () => ({
  findUserContextById: jest.fn(),
}));

jest.mock("@/modules/licensing/licensing.service", () => ({
  licensingService: {
    assertOrganizationCanLogin: jest.fn(),
  },
}));

jest.mock("@/shared/utils/jwt", () => ({
  generateTokenPair: jest.fn(),
  verifyRefreshToken: jest.fn(),
}));

import { env } from "@/config";
import { authRepository } from "@/modules/auth/auth.repository";
import { authService } from "@/modules/auth/auth.service";
import { findUserContextById } from "@/modules/users/user-context.service";
import { generateTokenPair, verifyRefreshToken } from "@/shared/utils/jwt";

const mockedAuthRepository = jest.mocked(authRepository);
const mockedFindUserContextById = jest.mocked(findUserContextById);
const mockedGenerateTokenPair = jest.mocked(generateTokenPair);
const mockedVerifyRefreshToken = jest.mocked(verifyRefreshToken);

describe("AuthService refresh token", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    env.TESTING_RELAX_AUTH_LIMITS = true;

    mockedAuthRepository.findUserById.mockResolvedValue({
      id: "user-1",
      email: "student@softlogicwhiteboard.com",
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      primaryOrganizationId: null,
    } as any);
    mockedGenerateTokenPair.mockReturnValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    });
    mockedFindUserContextById.mockResolvedValue({
      id: "user-1",
      email: "student@softlogicwhiteboard.com",
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
      timezone: "UTC",
      language: "en",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      invitedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastLoginAt: new Date("2026-01-01T00:00:00.000Z"),
      primaryOrganization: null,
      organizations: [],
      subscription: null,
      name: "Student Demo",
      avatar: null,
    } as any);
    mockedAuthRepository.createSession.mockResolvedValue({} as any);
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue(
      null,
    );
    mockedAuthRepository.updateSession.mockResolvedValue({} as any);
  });

  it("keeps the session alive in testing mode even when the refresh JWT is invalid", async () => {
    mockedAuthRepository.findSessionByToken.mockImplementation(
      async (token) => {
        if (token !== "expired-refresh-token") return null;
        return {
          id: "session-1",
          userId: "user-1",
          refreshToken: "expired-refresh-token",
          expiresAt: new Date("2026-01-01T00:00:00.000Z"),
        } as any;
      },
    );
    mockedVerifyRefreshToken.mockImplementation(() => {
      throw new Error("jwt expired");
    });

    const result = await authService.refreshToken("expired-refresh-token");

    expect(result.tokens.accessToken).toBe("new-access-token");
    expect(mockedAuthRepository.findUserById).toHaveBeenCalledWith("user-1");
    expect(mockedAuthRepository.deleteSession).not.toHaveBeenCalled();
    expect(mockedAuthRepository.createSession).not.toHaveBeenCalled();
    expect(mockedAuthRepository.updateSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        refreshToken: "new-refresh-token",
      }),
    );
    const updatePayload = mockedAuthRepository.updateSession.mock
      .calls[0][1] as {
      expiresAt: Date;
    };
    expect(updatePayload.expiresAt).toBeInstanceOf(Date);
    const ttlMs = updatePayload.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("still rejects refresh when there is no persisted session row", async () => {
    mockedAuthRepository.findSessionByToken.mockResolvedValue(null);
    mockedVerifyRefreshToken.mockImplementation(() => {
      throw new Error("jwt malformed");
    });

    await expect(
      authService.refreshToken("missing-refresh-token"),
    ).rejects.toMatchObject({
      message: "Invalid token",
      statusCode: 401,
    });

    expect(mockedAuthRepository.createSession).not.toHaveBeenCalled();
  });

  it("rejects refresh when the supplied client session was revoked", async () => {
    mockedAuthRepository.findSessionByToken.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      refreshToken: "refresh-token",
      clientSessionId: "web-session-1",
      expiresAt: new Date("2026-06-12T00:00:00.000Z"),
    } as any);
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      refreshToken: null,
      clientSessionId: "web-session-1",
      revokedAt: new Date("2026-06-05T00:00:00.000Z"),
      expiresAt: new Date("2026-06-12T00:00:00.000Z"),
    } as any);

    await expect(
      authService.refreshToken(
        "refresh-token",
        undefined,
        undefined,
        "web-session-1",
      ),
    ).rejects.toMatchObject({
      message: "Invalid token",
      statusCode: 401,
    });

    expect(mockedAuthRepository.updateSession).not.toHaveBeenCalled();
    expect(mockedAuthRepository.createSession).not.toHaveBeenCalled();
  });
});
