import { OtpType, UserRole, UserStatus } from "@prisma/client";

import { env } from "@/config";
import { AuthError } from "@/shared/errors/AuthError";

jest.mock("@/modules/auth/auth.repository", () => ({
  authRepository: {
    findUserByEmail: jest.fn(),
    findLatestOtp: jest.fn(),
    countRecentOtps: jest.fn(),
    invalidateUserOtps: jest.fn(),
    createOtp: jest.fn(),
    incrementOtpAttempts: jest.fn(),
    markOtpUsed: jest.fn(),
    updateUser: jest.fn(),
    findUserById: jest.fn(),
    findSessionByToken: jest.fn(),
    findUserSessionByClientSessionId: jest.fn(),
    createSession: jest.fn(),
    deleteSession: jest.fn(),
    deleteAllUserSessions: jest.fn(),
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

jest.mock("@/shared/utils/email", () => ({
  sendEmail: jest.fn(),
  getBrandLogoEmailAttachments: jest.fn(() => [
    {
      cid: "softlogic-logo",
      filename: "softlogic-logo.png",
      path: "/tmp/softlogic-logo.png",
    },
  ]),
  getOtpEmailHtml: jest.fn(() => "<p>otp</p>"),
  sendPasswordChangedEmail: jest.fn(),
}));

jest.mock("@/shared/utils/audit", () => ({
  writeAuditLog: jest.fn(),
}));

jest.mock("@/shared/utils/otp", () => ({
  generateOtp: jest.fn(),
  hashOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

import { authRepository } from "@/modules/auth/auth.repository";
import { authService } from "@/modules/auth/auth.service";
import { findUserContextById } from "@/modules/users/user-context.service";
import {
  getBrandLogoEmailAttachments,
  getOtpEmailHtml,
  sendEmail,
} from "@/shared/utils/email";
import { generateTokenPair } from "@/shared/utils/jwt";
import {
  generateOtp,
  hashOtp,
  verifyOtp as verifyOtpHash,
} from "@/shared/utils/otp";

const mockedAuthRepository = jest.mocked(authRepository);
const mockedFindUserContextById = jest.mocked(findUserContextById);
const mockedGenerateTokenPair = jest.mocked(generateTokenPair);
const mockedSendEmail = jest.mocked(sendEmail);
const mockedGetBrandLogoEmailAttachments = jest.mocked(
  getBrandLogoEmailAttachments,
);
const mockedGetOtpEmailHtml = jest.mocked(getOtpEmailHtml);
const mockedGenerateOtp = jest.mocked(generateOtp);
const mockedVerifyOtpHash = jest.mocked(verifyOtpHash);
const mockedHashOtp = jest.mocked(hashOtp);

const activeUser = {
  id: "user-1",
  email: "admin@softlogicwhiteboard.com",
  name: "Admin User",
  avatar: null,
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  timezone: "Asia/Kolkata",
  language: "en",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  invitedAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  lastLoginAt: null,
  googleId: null,
  isEmailVerified: true,
  passwordHash: "hashed-password",
  primaryOrganizationId: null,
};

const activeOtp = {
  id: "otp-1",
  userId: "user-1",
  code: "hashed-otp",
  type: OtpType.EMAIL_LOGIN,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  usedAt: null,
  attempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const safeUserContext = {
  id: "user-1",
  email: "admin@softlogicwhiteboard.com",
  name: "Admin User",
  avatar: null,
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  isEmailVerified: true,
  timezone: "Asia/Kolkata",
  language: "en",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  invitedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: null,
  primaryOrganization: null,
  organizations: [],
  subscription: null,
};

describe("AuthService fixed OTP allowlist", () => {
  const originalEnv = {
    NODE_ENV: env.NODE_ENV,
    DEV_FIXED_OTP_ENABLED: env.DEV_FIXED_OTP_ENABLED,
    DEV_FIXED_OTP_CODE: env.DEV_FIXED_OTP_CODE,
    DEV_FIXED_OTP_ALLOWED_EMAILS: env.DEV_FIXED_OTP_ALLOWED_EMAILS,
    TESTING_RELAX_AUTH_LIMITS: env.TESTING_RELAX_AUTH_LIMITS,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    env.NODE_ENV = "development";
    env.DEV_FIXED_OTP_ENABLED = true;
    env.DEV_FIXED_OTP_CODE = "1234";
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = "admin@softlogicwhiteboard.com";
    env.TESTING_RELAX_AUTH_LIMITS = false;

    mockedAuthRepository.findUserByEmail.mockResolvedValue(activeUser as any);
    mockedAuthRepository.findLatestOtp.mockResolvedValue(activeOtp as any);
    mockedAuthRepository.countRecentOtps.mockResolvedValue(0);
    mockedAuthRepository.invalidateUserOtps.mockResolvedValue({} as any);
    mockedAuthRepository.createOtp.mockResolvedValue({} as any);
    mockedAuthRepository.markOtpUsed.mockResolvedValue({} as any);
    mockedAuthRepository.updateUser.mockResolvedValue({} as any);
    mockedAuthRepository.findUserById.mockResolvedValue(activeUser as any);
    mockedAuthRepository.findSessionByToken.mockResolvedValue(null);
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue(
      null,
    );
    mockedAuthRepository.createSession.mockResolvedValue({} as any);
    mockedAuthRepository.deleteSession.mockResolvedValue(undefined as any);
    mockedAuthRepository.deleteAllUserSessions.mockResolvedValue(
      undefined as any,
    );
    mockedAuthRepository.updateSession.mockResolvedValue({} as any);
    mockedFindUserContextById.mockResolvedValue(safeUserContext as any);
    mockedGenerateTokenPair.mockReturnValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    mockedGenerateOtp.mockReturnValue("9876");
    mockedHashOtp.mockResolvedValue("hashed-generated-otp");
    mockedVerifyOtpHash.mockResolvedValue(false);
  });

  afterAll(() => {
    env.NODE_ENV = originalEnv.NODE_ENV;
    env.DEV_FIXED_OTP_ENABLED = originalEnv.DEV_FIXED_OTP_ENABLED;
    env.DEV_FIXED_OTP_CODE = originalEnv.DEV_FIXED_OTP_CODE;
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = originalEnv.DEV_FIXED_OTP_ALLOWED_EMAILS;
    env.TESTING_RELAX_AUTH_LIMITS = originalEnv.TESTING_RELAX_AUTH_LIMITS;
  });

  it("accepts 1234 for an allowlisted development email with an active OTP request", async () => {
    const result = await authService.verifyOtp(
      "admin@softlogicwhiteboard.com",
      "1234",
      "127.0.0.1",
    );

    expect(result.tokens.accessToken).toBe("access-token");
    expect(mockedAuthRepository.markOtpUsed).toHaveBeenCalledWith("otp-1");
    expect(mockedVerifyOtpHash).not.toHaveBeenCalled();
  });

  it("rejects 1234 in production even when fixed OTP is enabled and allowlisted", async () => {
    env.NODE_ENV = "production";

    await expect(
      authService.verifyOtp("admin@softlogicwhiteboard.com", "1234"),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedVerifyOtpHash).toHaveBeenCalledWith("1234", "hashed-otp");
    expect(mockedAuthRepository.incrementOtpAttempts).toHaveBeenCalledWith(
      "otp-1",
    );
    expect(mockedAuthRepository.markOtpUsed).not.toHaveBeenCalled();
  });

  it("replaces a revoked app client session during OTP login", async () => {
    mockedAuthRepository.findUserSessionByClientSessionId.mockResolvedValue({
      id: "stale-session",
      userId: "user-1",
      clientSessionId: "desktop-client-session",
      refreshToken: null,
      revokedAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    } as any);

    const result = await authService.verifyOtp(
      "admin@softlogicwhiteboard.com",
      "1234",
      "127.0.0.1",
      { clientType: "windows" },
      "desktop-client-session",
    );

    expect(result.tokens.accessToken).toBe("access-token");
    expect(mockedAuthRepository.deleteSession).not.toHaveBeenCalledWith(
      "stale-session",
    );
    expect(mockedAuthRepository.createSession).not.toHaveBeenCalled();
    expect(mockedAuthRepository.updateSession).toHaveBeenCalledWith(
      "stale-session",
      expect.objectContaining({
        clientSessionId: "desktop-client-session",
        refreshToken: "refresh-token",
        revokedAt: null,
      }),
    );
    expect(mockedAuthRepository.markOtpUsed).toHaveBeenCalledWith("otp-1");
  });

  it("rejects 1234 for a non-allowlisted development email", async () => {
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = "qa@softlogicwhiteboard.com";

    await expect(
      authService.verifyOtp("admin@softlogicwhiteboard.com", "1234"),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedVerifyOtpHash).toHaveBeenCalledWith("1234", "hashed-otp");
    expect(mockedAuthRepository.incrementOtpAttempts).toHaveBeenCalledWith(
      "otp-1",
    );
  });

  it("still requires an existing OTP record for allowlisted emails", async () => {
    mockedAuthRepository.findLatestOtp.mockResolvedValue(null);

    await expect(
      authService.verifyOtp("admin@softlogicwhiteboard.com", "1234"),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedAuthRepository.markOtpUsed).not.toHaveBeenCalled();
  });

  it("accepts 1234 for password reset verification with an active reset OTP request", async () => {
    mockedAuthRepository.findLatestOtp.mockResolvedValue({
      ...activeOtp,
      type: OtpType.PASSWORD_RESET,
    } as any);

    await expect(
      authService.verifyPasswordResetOtp(
        "admin@softlogicwhiteboard.com",
        "1234",
      ),
    ).resolves.toEqual({ message: "OTP verified successfully" });

    expect(mockedAuthRepository.findLatestOtp).toHaveBeenCalledWith(
      "user-1",
      OtpType.PASSWORD_RESET,
    );
    expect(mockedVerifyOtpHash).not.toHaveBeenCalled();
    expect(mockedAuthRepository.incrementOtpAttempts).not.toHaveBeenCalled();
  });

  it("accepts 1234 while completing a password reset for an allowlisted tester", async () => {
    mockedAuthRepository.findLatestOtp.mockResolvedValue({
      ...activeOtp,
      type: OtpType.PASSWORD_RESET,
    } as any);

    await expect(
      authService.completePasswordResetOtp(
        "admin@softlogicwhiteboard.com",
        "1234",
        "newpass1",
      ),
    ).resolves.toEqual({ message: "Password changed successfully" });

    expect(mockedVerifyOtpHash).not.toHaveBeenCalled();
    expect(mockedAuthRepository.markOtpUsed).toHaveBeenCalledWith("otp-1");
    expect(mockedAuthRepository.updateUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ isEmailVerified: true }),
    );
  });

  it("rejects 1234 for password reset when the email is not allowlisted", async () => {
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = "qa@softlogicwhiteboard.com";
    mockedAuthRepository.findLatestOtp.mockResolvedValue({
      ...activeOtp,
      type: OtpType.PASSWORD_RESET,
    } as any);

    await expect(
      authService.verifyPasswordResetOtp(
        "admin@softlogicwhiteboard.com",
        "1234",
      ),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedVerifyOtpHash).toHaveBeenCalledWith("1234", "hashed-otp");
    expect(mockedAuthRepository.incrementOtpAttempts).toHaveBeenCalledWith(
      "otp-1",
    );
  });

  it("still requires an active reset OTP record before accepting 1234", async () => {
    mockedAuthRepository.findLatestOtp.mockResolvedValue(null);

    await expect(
      authService.verifyPasswordResetOtp(
        "admin@softlogicwhiteboard.com",
        "1234",
      ),
    ).rejects.toThrow(AuthError.otpInvalid());

    expect(mockedVerifyOtpHash).not.toHaveBeenCalled();
    expect(mockedAuthRepository.markOtpUsed).not.toHaveBeenCalled();
  });

  it("skips OTP send throttling when testing auth limits are relaxed", async () => {
    env.TESTING_RELAX_AUTH_LIMITS = true;
    mockedAuthRepository.countRecentOtps.mockResolvedValue(99);

    await expect(
      authService.sendOtp("admin@softlogicwhiteboard.com"),
    ).resolves.toEqual({ message: "OTP sent successfully" });

    expect(mockedAuthRepository.invalidateUserOtps).toHaveBeenCalled();
    expect(mockedAuthRepository.createOtp).toHaveBeenCalled();
    expect(mockedHashOtp).toHaveBeenCalledWith("9876");
    expect(mockedGetOtpEmailHtml).toHaveBeenCalledWith("9876");
  });

  it("sends the generated OTP in email content for allowlisted tester accounts", async () => {
    await expect(
      authService.sendOtp("admin@softlogicwhiteboard.com"),
    ).resolves.toEqual({ message: "OTP sent successfully" });

    expect(mockedGenerateOtp).toHaveBeenCalledTimes(1);
    expect(mockedHashOtp).toHaveBeenCalledWith("9876");
    expect(mockedGetBrandLogoEmailAttachments).toHaveBeenCalled();
    expect(mockedGetOtpEmailHtml).toHaveBeenCalledWith("9876");
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            cid: "softlogic-logo",
            filename: "softlogic-logo.png",
          }),
        ],
        to: "admin@softlogicwhiteboard.com",
        subject: "Your Softlogic Whiteboard Login Code",
        html: "<p>otp</p>",
      }),
    );
  });

  it("skips OTP attempt blocking when testing auth limits are relaxed", async () => {
    env.TESTING_RELAX_AUTH_LIMITS = true;
    mockedVerifyOtpHash.mockResolvedValue(true);
    mockedAuthRepository.findLatestOtp.mockResolvedValue({
      ...activeOtp,
      attempts: 99,
    } as any);

    await expect(
      authService.verifyOtp("admin@softlogicwhiteboard.com", "9876"),
    ).resolves.toMatchObject({
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
    });

    expect(mockedAuthRepository.markOtpUsed).toHaveBeenCalledWith("otp-1");
  });

  it("accepts 1234 for any active email when testing auth limits are relaxed", async () => {
    env.TESTING_RELAX_AUTH_LIMITS = true;
    env.DEV_FIXED_OTP_ALLOWED_EMAILS = "";

    await expect(
      authService.verifyOtp("qa@softlogicwhiteboard.com", "1234"),
    ).resolves.toMatchObject({
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
    });

    expect(mockedAuthRepository.markOtpUsed).toHaveBeenCalledWith("otp-1");
    expect(mockedVerifyOtpHash).not.toHaveBeenCalled();
  });

  it("does not consume the OTP when session payload construction fails", async () => {
    env.TESTING_RELAX_AUTH_LIMITS = true;
    mockedVerifyOtpHash.mockResolvedValue(true);
    mockedFindUserContextById.mockResolvedValue(null as any);

    await expect(
      authService.verifyOtp("admin@softlogicwhiteboard.com", "9876"),
    ).rejects.toThrow(AuthError.invalidCredentials());

    expect(mockedAuthRepository.createSession).toHaveBeenCalled();
    expect(mockedAuthRepository.markOtpUsed).not.toHaveBeenCalled();
  });
});
