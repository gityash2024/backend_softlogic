import {
  GoogleDesktopAuthAttempt,
  GoogleDesktopAuthAttemptStatus,
  Otp,
  OtpType,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { env, prisma } from "@/config";
import { licensingService } from "@/modules/licensing/licensing.service";
import { findUserContextById } from "@/modules/users/user-context.service";
import { AuthError } from "@/shared/errors/AuthError";
import { AppError } from "@/shared/errors/AppError";
import {
  getBrandLogoEmailAttachments,
  getOtpEmailHtml,
  sendEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "@/shared/utils/email";
import { writeAuditLog } from "@/shared/utils/audit";
import { generateTokenPair, verifyRefreshToken } from "@/shared/utils/jwt";
import {
  generateOtp,
  hashOtp,
  verifyOtp as verifyOtpHash,
} from "@/shared/utils/otp";

import { authRepository } from "./auth.repository";
import {
  AuthResponse,
  DesktopGoogleAuthStartResponse,
  DesktopGoogleAuthStatusResponse,
} from "./auth.types";
import { googleStrategy } from "./strategies/google.strategy";

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_SENDS_PER_HOUR = 3;
const FALLBACK_FIXED_OTP = "1234";
const ADMIN_LOGIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.CUSTOMER_ADMIN,
  UserRole.ADMIN,
];
const PORTAL_LOGIN_ROLES: UserRole[] = [
  UserRole.TEACHER,
  UserRole.STUDENT,
  UserRole.PARENT,
];
const PASSWORD_LOGIN_ROLES: UserRole[] = [
  ...ADMIN_LOGIN_ROLES,
  ...PORTAL_LOGIN_ROLES,
];
const PASSWORD_RESET_EXPIRY_HOURS = 24;
const PASSWORD_SETUP_EXPIRY_DAYS = 7;
const DEFAULT_REFRESH_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_DESKTOP_AUTH_EXPIRY_MINUTES = 10;
const GOOGLE_DESKTOP_POLL_INTERVAL_MS = 2000;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
let desktopGoogleCallbackLogoDataUri: string | null = null;
type AuthDeviceInfo = Prisma.JsonObject;
type AuthSessionTouchOptions = {
  clientSessionId?: string | null;
  currentRefreshToken?: string | null;
  nextRefreshToken?: string | null;
  deviceInfo?: AuthDeviceInfo;
  ipAddress?: string;
};

interface GoogleTokenExchangeResponse {
  error?: string;
  error_description?: string;
  id_token?: string;
}

interface DesktopGoogleCallbackPageResponse {
  html: string;
  statusCode: number;
}

type DesktopGoogleCallbackVariant = "success" | "warning" | "error";

const refreshSessionExpiresAt = (): Date =>
  new Date(Date.now() + refreshSessionTtlMs());

const refreshSessionTtlMs = (): number => {
  const value = env.JWT_REFRESH_EXPIRES_IN.trim();
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(value);
  if (!match) {
    return DEFAULT_REFRESH_SESSION_MS;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60 * 1000
          : unit === "h"
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
  return amount > 0 ? amount * multiplier : DEFAULT_REFRESH_SESSION_MS;
};

export class AuthService {
  /**
   * Resolves the error to throw when no usable active account matched the
   * supplied email. If a soft-deleted account still owns the address, surface a
   * clear "account suspended" message; otherwise fall back to the generic
   * credentials error so unknown emails stay non-enumerable.
   */
  private async noActiveAccountError(email: string): Promise<AuthError> {
    const suspended = await authRepository.findDeletedUserByEmail(email);
    return suspended
      ? AuthError.accountSuspended(
          await this.suspendedAccountDetails(suspended),
        )
      : AuthError.invalidCredentials();
  }

  private async suspendedAccountDetails(
    user: Pick<User, "primaryOrganizationId">,
  ): Promise<Record<string, unknown>> {
    const [superAdminEmail, organization] = await Promise.all([
      authRepository.findActiveSuperAdminEmail(),
      user.primaryOrganizationId
        ? authRepository.findOrganizationContactById(user.primaryOrganizationId)
        : Promise.resolve(null),
    ]);

    return {
      reason: "ACCOUNT_SUSPENDED",
      contact: {
        superAdminEmail: superAdminEmail ?? null,
        organizationName: organization?.name ?? null,
        supportEmail: organization?.supportEmail ?? null,
        supportPhone: organization?.supportPhone ?? null,
      },
    };
  }

  private async accountSuspendedError(
    user: Pick<User, "primaryOrganizationId">,
  ): Promise<AuthError> {
    return AuthError.accountSuspended(await this.suspendedAccountDetails(user));
  }

  async sendOtp(email: string): Promise<{ message: string }> {
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw await this.noActiveAccountError(email);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtpCount = await authRepository.countRecentOtps(
      user.id,
      OtpType.EMAIL_LOGIN,
      oneHourAgo,
    );
    if (
      !this.shouldRelaxAuthLimits &&
      recentOtpCount >= MAX_OTP_SENDS_PER_HOUR
    ) {
      throw AuthError.rateLimited();
    }

    await authRepository.invalidateUserOtps(user.id, OtpType.EMAIL_LOGIN);

    const otpCode = generateOtp();
    const hashedOtp = await hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await authRepository.createOtp({
      userId: user.id,
      code: hashedOtp,
      type: OtpType.EMAIL_LOGIN,
      expiresAt,
    });

    try {
      const brandLogoAttachments = getBrandLogoEmailAttachments();
      await sendEmail({
        attachments:
          brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
        to: email,
        subject: "Your Softlogic Whiteboard Login Code",
        html: getOtpEmailHtml(otpCode),
      });
    } catch {
      console.log(`OTP for ${email}: ${otpCode}`);
    }

    return { message: "OTP sent successfully" };
  }

  async verifyOtp(
    email: string,
    code: string,
    ipAddress?: string,
    deviceInfo?: AuthDeviceInfo,
    clientSessionId?: string | null,
  ): Promise<AuthResponse> {
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw await this.noActiveAccountError(email);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }

    const otp = await authRepository.findLatestOtp(
      user.id,
      OtpType.EMAIL_LOGIN,
    );
    if (!otp) {
      throw AuthError.otpInvalid();
    }

    if (new Date() > otp.expiresAt) {
      throw AuthError.otpExpired();
    }

    if (!this.shouldRelaxAuthLimits && otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw AuthError.otpMaxAttempts();
    }

    const normalizedCode = code.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const isFixedOtpMatch =
      this.fixedOtpCode != null &&
      normalizedCode == this.fixedOtpCode &&
      this.shouldUseFixedOtpForEmail(normalizedEmail);
    const isValid =
      isFixedOtpMatch || (await verifyOtpHash(normalizedCode, otp.code));
    if (!isValid) {
      await authRepository.incrementOtpAttempts(otp.id);
      throw AuthError.otpInvalid();
    }

    await authRepository.updateUser(user.id, {
      isEmailVerified: true,
      lastLoginAt: new Date(),
    });

    const refreshedUser = await authRepository.findUserById(user.id);
    if (!refreshedUser) {
      throw AuthError.invalidCredentials();
    }
    await licensingService.assertOrganizationCanLogin(refreshedUser.id);

    const tokenPayload = {
      userId: refreshedUser.id,
      email: refreshedUser.email,
      role: refreshedUser.role,
      organizationId: refreshedUser.primaryOrganizationId,
    };
    const tokens = generateTokenPair(tokenPayload);

    const expiresAt = refreshSessionExpiresAt();
    await this.touchOwnSession(
      user.id,
      {
        clientSessionId,
        currentRefreshToken: tokens.refreshToken,
        deviceInfo,
        ipAddress,
      },
      expiresAt,
    );

    const safeUser = await findUserContextById(user.id);
    if (!safeUser) {
      throw AuthError.invalidCredentials();
    }

    await authRepository.markOtpUsed(otp.id);

    return {
      tokens,
      user: safeUser,
    };
  }

  async adminLogin(
    email: string,
    password: string,
    ipAddress?: string,
    deviceInfo?: AuthDeviceInfo,
    clientSessionId?: string | null,
  ): Promise<AuthResponse> {
    return this.passwordLogin(
      email,
      password,
      ipAddress,
      ADMIN_LOGIN_ROLES,
      deviceInfo,
      clientSessionId,
    );
  }

  async portalLogin(
    email: string,
    password: string,
    ipAddress?: string,
    deviceInfo?: AuthDeviceInfo,
    clientSessionId?: string | null,
  ): Promise<AuthResponse> {
    return this.passwordLogin(
      email,
      password,
      ipAddress,
      PORTAL_LOGIN_ROLES,
      deviceInfo,
      clientSessionId,
    );
  }

  private async passwordLogin(
    email: string,
    password: string,
    ipAddress: string | undefined,
    allowedRoles: UserRole[],
    deviceInfo?: AuthDeviceInfo,
    clientSessionId?: string | null,
  ): Promise<AuthResponse> {
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw await this.noActiveAccountError(email);
    }
    if (!user.passwordHash) {
      throw AuthError.invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw AuthError.invalidCredentials();
    }

    if (!allowedRoles.includes(user.role)) {
      throw AuthError.unauthorized();
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }
    await licensingService.assertOrganizationCanLogin(user.id);

    await authRepository.updateUser(user.id, {
      lastLoginAt: new Date(),
    });

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.primaryOrganizationId,
    };
    const tokens = generateTokenPair(tokenPayload);

    const expiresAt = refreshSessionExpiresAt();
    await this.touchOwnSession(
      user.id,
      {
        clientSessionId,
        currentRefreshToken: tokens.refreshToken,
        deviceInfo,
        ipAddress,
      },
      expiresAt,
    );

    const safeUser = await findUserContextById(user.id);
    if (!safeUser) {
      throw AuthError.invalidCredentials();
    }

    return {
      tokens,
      user: safeUser,
    };
  }

  async googleSignIn(
    idToken: string,
    ipAddress?: string,
    deviceInfo?: AuthDeviceInfo,
    clientSessionId?: string | null,
  ): Promise<AuthResponse> {
    if (!idToken.trim()) {
      throw new AppError("Google ID token is required", 400);
    }

    const googleUser = await googleStrategy.verifyIdToken(idToken);
    const googleEmail = googleUser.email.trim().toLowerCase();
    const now = new Date();

    let user = await authRepository.findUserByGoogleId(googleUser.sub);
    if (user && user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }

    if (!user) {
      const existingUser = await authRepository.findUserByEmail(googleEmail);
      if (existingUser && existingUser.status !== UserStatus.ACTIVE) {
        throw await this.accountSuspendedError(existingUser);
      }

      if (existingUser) {
        user = await authRepository.updateUser(existingUser.id, {
          googleId: googleUser.sub,
          avatar: googleUser.picture ?? existingUser.avatar,
          isEmailVerified: true,
          lastLoginAt: now,
          name: existingUser.name ?? googleUser.name,
        });
      } else {
        throw await this.noActiveAccountError(googleEmail);
      }
    } else {
      user = await authRepository.updateUser(user.id, {
        avatar: googleUser.picture ?? user.avatar,
        isEmailVerified: true,
        lastLoginAt: now,
        name: user.name ?? googleUser.name,
      });
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.primaryOrganizationId,
    };
    const tokens = generateTokenPair(tokenPayload);

    const expiresAt = refreshSessionExpiresAt();
    await this.touchOwnSession(
      user.id,
      {
        clientSessionId,
        currentRefreshToken: tokens.refreshToken,
        deviceInfo,
        ipAddress,
      },
      expiresAt,
    );

    const safeUser = await findUserContextById(user.id);
    if (!safeUser) {
      throw AuthError.invalidCredentials();
    }
    await licensingService.assertOrganizationCanLogin(user.id);

    return {
      tokens,
      user: safeUser,
    };
  }

  async startDesktopGoogleSignIn(): Promise<DesktopGoogleAuthStartResponse> {
    this.ensureGoogleDesktopAuthConfigured();

    const expiresAt = new Date(
      Date.now() + GOOGLE_DESKTOP_AUTH_EXPIRY_MINUTES * 60 * 1000,
    );
    const attempt = await authRepository.createGoogleDesktopAuthAttempt({
      state: randomUUID(),
      expiresAt,
    });

    return {
      attemptId: attempt.id,
      authUrl: this.buildGoogleDesktopAuthUrl(attempt.state),
      expiresAt: expiresAt.toISOString(),
      pollIntervalMs: GOOGLE_DESKTOP_POLL_INTERVAL_MS,
    };
  }

  async handleDesktopGoogleCallback(params: {
    code?: string;
    deviceInfo?: AuthDeviceInfo;
    error?: string;
    errorDescription?: string;
    ipAddress?: string;
    state?: string;
  }): Promise<DesktopGoogleCallbackPageResponse> {
    this.ensureGoogleDesktopAuthConfigured();

    const { code, error, errorDescription, ipAddress, state } = params;
    if (!state?.trim()) {
      return this.renderDesktopGoogleCallbackPage({
        message: "This sign-in request is missing its verification state.",
        statusCode: 400,
        variant: "warning",
        title: "Sign-in could not be completed",
      });
    }

    const attempt = await authRepository.findGoogleDesktopAuthAttemptByState(
      state.trim(),
    );
    if (!attempt) {
      return this.renderDesktopGoogleCallbackPage({
        message: "This sign-in request could not be found.",
        statusCode: 404,
        variant: "warning",
        title: "We could not find this sign-in request",
      });
    }

    const expiredAttempt = await this.expireAttemptIfNeeded(attempt);
    if (expiredAttempt) {
      return this.renderDesktopGoogleCallbackPage({
        message: "This sign-in request has expired.",
        statusCode: 410,
        variant: "warning",
        title: "Your sign-in link has expired",
      });
    }

    if (error?.trim()) {
      const message =
        errorDescription?.trim() ||
        "Google sign-in was cancelled before it completed.";
      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        errorMessage: message,
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return this.renderDesktopGoogleCallbackPage({
        message,
        statusCode: 400,
        variant: "warning",
        title: "Sign-in cancelled",
      });
    }

    if (!code?.trim()) {
      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        errorMessage: "Google did not return an authorization code.",
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return this.renderDesktopGoogleCallbackPage({
        message: "Google did not return an authorization code.",
        statusCode: 400,
        variant: "error",
        title: "Sign-in could not be completed",
      });
    }

    try {
      const idToken = await this.exchangeGoogleCodeForIdToken(code.trim());
      const session = await this.googleSignIn(
        idToken,
        ipAddress,
        params.deviceInfo,
      );

      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        completedAt: new Date(),
        errorMessage: null,
        sessionPayload: this.serializeAuthResponse(session),
        status: GoogleDesktopAuthAttemptStatus.COMPLETED,
        user: { connect: { id: session.user.id } },
      });

      return this.renderDesktopGoogleCallbackPage({
        message: "Google sign-in is complete.",
        statusCode: 200,
        variant: "success",
        title: "You are signed in",
      });
    } catch (error) {
      const message = this.getDesktopGoogleFailureMessage(error);
      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        errorMessage: message,
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });

      return this.renderDesktopGoogleCallbackPage({
        message,
        statusCode: error instanceof AppError ? error.statusCode : 500,
        variant: "error",
        title: "Sign-in failed",
      });
    }
  }

  async getDesktopGoogleSignInStatus(
    attemptId: string,
  ): Promise<DesktopGoogleAuthStatusResponse> {
    const attempt =
      await authRepository.findGoogleDesktopAuthAttemptById(attemptId);
    if (!attempt) {
      throw new AppError("Google sign-in session was not found.", 404);
    }

    const refreshedAttempt =
      (await this.expireAttemptIfNeeded(attempt)) ?? attempt;

    if (refreshedAttempt.status === GoogleDesktopAuthAttemptStatus.PENDING) {
      return {
        message: "Waiting for Google sign-in to complete.",
        status: "pending",
      };
    }

    if (refreshedAttempt.status === GoogleDesktopAuthAttemptStatus.EXPIRED) {
      return {
        message:
          refreshedAttempt.errorMessage ??
          "Google sign-in session expired. Please try again.",
        status: "expired",
      };
    }

    if (refreshedAttempt.status === GoogleDesktopAuthAttemptStatus.FAILED) {
      return {
        message:
          refreshedAttempt.errorMessage ??
          "Google sign-in could not be completed.",
        status: "failed",
      };
    }

    if (refreshedAttempt.consumedAt) {
      return {
        message:
          "Google sign-in has already been completed for this request. Please start again if needed.",
        status: "failed",
      };
    }

    const session = this.deserializeAuthResponse(
      refreshedAttempt.sessionPayload,
    );
    if (!session) {
      await authRepository.updateGoogleDesktopAuthAttempt(refreshedAttempt.id, {
        errorMessage:
          "Google sign-in finished without a valid session payload.",
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return {
        message: "Google sign-in finished without a valid session payload.",
        status: "failed",
      };
    }

    const consumed = await authRepository.consumeGoogleDesktopAuthAttempt(
      refreshedAttempt.id,
      new Date(),
    );
    if (!consumed) {
      return {
        message:
          "Google sign-in has already been completed for this request. Please start again if needed.",
        status: "failed",
      };
    }

    return {
      message: "Google sign-in completed successfully.",
      session,
      status: "completed",
    };
  }

  async refreshToken(
    refreshToken: string,
    ipAddress?: string,
    deviceInfo?: AuthDeviceInfo,
    clientSessionId?: string | null,
  ): Promise<AuthResponse> {
    try {
      const session = await authRepository.findSessionByToken(refreshToken);
      if (!session) {
        throw AuthError.tokenInvalid();
      }
      if (session.revokedAt) {
        await authRepository.deleteSession(session.id);
        throw AuthError.tokenInvalid();
      }

      const decoded = this.shouldRelaxAuthLimits
        ? null
        : verifyRefreshToken(refreshToken);

      if (!this.shouldRelaxAuthLimits && new Date() > session.expiresAt) {
        await authRepository.deleteSession(session.id);
        throw AuthError.tokenExpired();
      }

      const user = await authRepository.findUserById(
        decoded?.userId ?? session.userId,
      );
      if (!user || user.status !== UserStatus.ACTIVE) {
        throw AuthError.invalidCredentials();
      }
      await licensingService.assertOrganizationCanLogin(user.id);

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.primaryOrganizationId,
      };
      const tokens = generateTokenPair(tokenPayload);

      const expiresAt = refreshSessionExpiresAt();
      await this.touchOwnSession(
        user.id,
        {
          clientSessionId: clientSessionId ?? session.clientSessionId,
          currentRefreshToken: refreshToken,
          nextRefreshToken: tokens.refreshToken,
          deviceInfo:
            deviceInfo && Object.keys(deviceInfo).length > 0
              ? deviceInfo
              : ((session.deviceInfo as AuthDeviceInfo | null) ?? undefined),
          ipAddress: ipAddress ?? session.ipAddress ?? undefined,
        },
        expiresAt,
      );

      const safeUser = await findUserContextById(user.id);
      if (!safeUser) {
        throw AuthError.invalidCredentials();
      }

      return {
        tokens,
        user: safeUser,
      };
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw AuthError.tokenInvalid();
    }
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await authRepository.deleteSessionByToken(refreshToken);
    } catch {
      // Session might not exist.
    }
  }

  async listOwnSessions(
    userId: string,
    currentRefreshToken?: string | null,
    options?: Omit<AuthSessionTouchOptions, "currentRefreshToken">,
  ): Promise<
    Array<{
      id: string;
      clientSessionId: string | null;
      deviceInfo: Prisma.JsonValue | null;
      ipAddress: string | null;
      createdAt: Date;
      lastSeenAt: Date | null;
      expiresAt: Date;
      isCurrent: boolean;
    }>
  > {
    await this.touchOwnSession(userId, {
      clientSessionId: options?.clientSessionId,
      currentRefreshToken,
      deviceInfo: options?.deviceInfo,
      ipAddress: options?.ipAddress,
    }).catch(() => undefined);
    const sessions = await authRepository.listUserSessions(userId);
    const currentToken = currentRefreshToken?.trim();
    return sessions.map((session) => ({
      id: session.id,
      clientSessionId: session.clientSessionId,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      isCurrent: Boolean(
        (currentToken && session.refreshToken === currentToken) ||
        (options?.clientSessionId &&
          session.clientSessionId === options.clientSessionId),
      ),
    }));
  }

  async heartbeatOwnSession(
    userId: string,
    options: AuthSessionTouchOptions,
  ): Promise<{ id: string; lastSeenAt: Date | null }> {
    const session = await this.touchOwnSession(userId, options);
    return { id: session.id, lastSeenAt: session.lastSeenAt };
  }

  async revokeOwnSession(
    userId: string,
    sessionId: string,
    currentRefreshToken?: string | null,
    currentClientSessionId?: string | null,
  ): Promise<{ message: string }> {
    const session = await authRepository.findUserSessionById(userId, sessionId);
    if (!session) {
      throw new AppError("Login session not found", 404);
    }

    const currentToken = currentRefreshToken?.trim();
    if (
      (currentToken && session.refreshToken === currentToken) ||
      (currentClientSessionId &&
        session.clientSessionId === currentClientSessionId)
    ) {
      throw new AppError("Use Sign out to end your current session", 400);
    }

    await authRepository.updateSession(session.id, {
      refreshToken: null,
      revokedAt: new Date(),
    });
    return { message: "Login session revoked successfully" };
  }

  private async touchOwnSession(
    userId: string,
    options: AuthSessionTouchOptions,
    expiresAt = refreshSessionExpiresAt(),
  ) {
    const now = new Date();
    const refreshToken = options.currentRefreshToken?.trim() || null;
    const nextRefreshToken = options.nextRefreshToken?.trim() || null;
    const clientSessionId = options.clientSessionId?.trim() || null;
    if (!refreshToken && !clientSessionId && !nextRefreshToken) {
      throw AuthError.tokenInvalid();
    }

    const tokenSession = refreshToken
      ? await authRepository.findSessionByToken(refreshToken)
      : null;
    const clientSession = clientSessionId
      ? await authRepository.findUserSessionByClientSessionId(
          userId,
          clientSessionId,
        )
      : null;

    if (tokenSession && tokenSession.userId !== userId) {
      throw AuthError.tokenInvalid();
    }
    if (clientSession && clientSession.userId !== userId) {
      throw AuthError.tokenInvalid();
    }

    const session = clientSession ?? tokenSession;
    if (session?.revokedAt && tokenSession) {
      throw AuthError.tokenInvalid();
    }

    if (tokenSession && clientSession && tokenSession.id !== clientSession.id) {
      await authRepository.deleteSession(tokenSession.id);
    }

    const data: Prisma.SessionUpdateInput = {
      expiresAt,
      lastSeenAt: now,
      revokedAt: null,
    };
    if (nextRefreshToken || refreshToken) {
      data.refreshToken = nextRefreshToken ?? refreshToken;
    }
    if (clientSessionId) data.clientSessionId = clientSessionId;
    if (options.deviceInfo && Object.keys(options.deviceInfo).length > 0) {
      data.deviceInfo = options.deviceInfo;
    }
    if (options.ipAddress) data.ipAddress = options.ipAddress;

    if (session) {
      return authRepository.updateSession(session.id, data);
    }

    return authRepository.createSession({
      userId,
      refreshToken: nextRefreshToken ?? refreshToken,
      clientSessionId,
      deviceInfo: options.deviceInfo,
      ipAddress: options.ipAddress,
      expiresAt,
      lastSeenAt: now,
    });
  }

  async validatePasswordSetupToken(token: string): Promise<{
    email: string;
    name: string | null;
    role: UserRole;
    hasPassword: boolean;
  }> {
    const { otpId, secret } = this.parsePasswordSetupToken(token);
    const otp = await authRepository.findOtpById(otpId);
    if (
      !otp ||
      otp.type !== OtpType.PASSWORD_RESET ||
      otp.usedAt ||
      new Date() > otp.expiresAt
    ) {
      throw new AppError("Password setup link is invalid or expired", 400);
    }

    if (
      !otp.user ||
      otp.user.deletedAt ||
      otp.user.status !== UserStatus.ACTIVE
    ) {
      throw new AppError("Password setup account is not active", 400);
    }
    if (!PASSWORD_LOGIN_ROLES.includes(otp.user.role)) {
      throw new AppError(
        "Password setup is only available for portal accounts",
        403,
      );
    }

    const matches = await bcrypt.compare(secret, otp.code);
    if (!matches) {
      throw new AppError("Password setup link is invalid or expired", 400);
    }

    return {
      email: otp.user.email,
      name: otp.user.name,
      role: otp.user.role,
      hasPassword: otp.user.passwordHash != null,
    };
  }

  async completePasswordSetup(
    input: {
      token: string;
      password: string;
    },
    ipAddress?: string,
  ): Promise<{ email: string; message: string }> {
    const { otpId } = this.parsePasswordSetupToken(input.token);
    const setup = await this.validatePasswordSetupToken(input.token);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const otp = await authRepository.findOtpById(otpId);
    if (!otp) {
      throw new AppError("Password setup link is invalid or expired", 400);
    }

    await authRepository.updateUser(otp.userId, {
      passwordHash,
      isEmailVerified: true,
    });
    await authRepository.markOtpUsed(otp.id);
    await authRepository.deleteAllUserSessions(otp.userId);

    try {
      await writeAuditLog({
        actorUserId: otp.userId,
        action: "auth.password.complete",
        targetType: "user",
        targetId: otp.userId,
        summary: "User completed password setup",
        ip: ipAddress,
      });
    } catch {
      // Never block the request on audit failure.
    }

    try {
      await sendPasswordChangedEmail({
        to: setup.email,
        name: setup.name,
        role: setup.role,
      });
    } catch {
      // Fire-and-forget — email failure must not break password setup.
    }

    return {
      email: setup.email,
      message: "Password set successfully",
    };
  }

  /**
   * Change the password for an already-authenticated admin. Verifies the
   * current password, persists the new hash, sends a confirmation email, and
   * invalidates other sessions. When the caller's current refresh token is
   * provided it is preserved so the active session stays valid.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    options?: { ipAddress?: string; keepRefreshToken?: string | null },
  ): Promise<{ message: string }> {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw AuthError.invalidCredentials();
    }
    if (!user.passwordHash) {
      throw new AppError("Current password is incorrect", 400);
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new AppError("Current password is incorrect", 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await authRepository.updateUser(user.id, { passwordHash });

    // Invalidate other sessions; keep the caller's current session when we can
    // identify it from the supplied refresh token.
    const keepRefreshToken = options?.keepRefreshToken?.trim();
    if (keepRefreshToken) {
      await authRepository.deleteOtherUserSessions(user.id, keepRefreshToken);
    } else {
      await authRepository.deleteAllUserSessions(user.id);
    }

    try {
      await writeAuditLog({
        actorUserId: user.id,
        action: "auth.password.change",
        targetType: "user",
        targetId: user.id,
        summary: "User changed password",
        ip: options?.ipAddress,
      });
    } catch {
      // Never block the request on audit failure.
    }

    try {
      await sendPasswordChangedEmail({
        to: user.email,
        name: user.name,
        role: user.role,
      });
    } catch {
      // Fire-and-forget — email failure must not break the password change.
    }

    return { message: "Password changed successfully" };
  }

  async changePasswordWithCurrent(
    email: string,
    currentPassword: string,
    newPassword: string,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await authRepository.findUserByEmail(normalizedEmail);
    if (
      !user ||
      !user.passwordHash ||
      !PASSWORD_LOGIN_ROLES.includes(user.role)
    ) {
      throw new AppError("Current password is incorrect", 400);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new AppError("Current password is incorrect", 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await authRepository.updateUser(user.id, {
      isEmailVerified: true,
      passwordHash,
    });
    await authRepository.deleteAllUserSessions(user.id);

    try {
      await writeAuditLog({
        actorUserId: user.id,
        action: "auth.password.change_with_current",
        targetType: "user",
        targetId: user.id,
        summary: "User changed password using current password from reset flow",
        ip: ipAddress,
      });
    } catch {
      // Never block the request on audit failure.
    }

    try {
      await sendPasswordChangedEmail({
        to: user.email,
        name: user.name,
        role: user.role,
      });
    } catch {
      // Fire-and-forget — email failure must not break the password change.
    }

    return { message: "Password changed successfully" };
  }

  async requestPasswordResetOtp(
    email: string,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const genericMessage =
      "If the email matches a SoftLogic account, a password reset code has been sent.";
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return { message: genericMessage };
    }

    const user = await authRepository.findUserByEmail(normalizedEmail);
    if (
      !user ||
      !user.passwordHash ||
      !PASSWORD_LOGIN_ROLES.includes(user.role)
    ) {
      return { message: genericMessage };
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtpCount = await authRepository.countRecentOtps(
      user.id,
      OtpType.PASSWORD_RESET,
      oneHourAgo,
    );
    if (
      !this.shouldRelaxAuthLimits &&
      recentOtpCount >= MAX_OTP_SENDS_PER_HOUR
    ) {
      throw AuthError.rateLimited();
    }

    await authRepository.invalidateUserOtps(user.id, OtpType.PASSWORD_RESET);

    const otpCode = generateOtp();
    const hashedOtp = await hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await authRepository.createOtp({
      userId: user.id,
      code: hashedOtp,
      type: OtpType.PASSWORD_RESET,
      expiresAt,
    });

    try {
      await writeAuditLog({
        actorUserId: user.id,
        action: "auth.password_reset_otp.request",
        targetType: "user",
        targetId: user.id,
        summary: "User requested a password reset OTP",
        ip: ipAddress,
      });
    } catch {
      // Never block the request on audit failure.
    }

    try {
      const brandLogoAttachments = getBrandLogoEmailAttachments();
      await sendEmail({
        attachments:
          brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
        to: user.email,
        subject: "Your Softlogic Whiteboard Password Reset Code",
        html: getOtpEmailHtml(otpCode),
      });
    } catch {
      console.log(`Password reset OTP for ${user.email}: ${otpCode}`);
    }

    return { message: genericMessage };
  }

  async verifyPasswordResetOtp(
    email: string,
    code: string,
  ): Promise<{ message: string }> {
    await this.assertValidPasswordResetOtp(email, code);
    return { message: "OTP verified successfully" };
  }

  async completePasswordResetOtp(
    email: string,
    code: string,
    newPassword: string,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const { user, otp } = await this.assertValidPasswordResetOtp(email, code);
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await authRepository.updateUser(user.id, {
      isEmailVerified: true,
      passwordHash,
    });
    await authRepository.markOtpUsed(otp.id);
    await authRepository.deleteAllUserSessions(user.id);

    try {
      await writeAuditLog({
        actorUserId: user.id,
        action: "auth.password_reset_otp.complete",
        targetType: "user",
        targetId: user.id,
        summary: "User completed password reset with OTP",
        ip: ipAddress,
      });
    } catch {
      // Never block the request on audit failure.
    }

    try {
      await sendPasswordChangedEmail({
        to: user.email,
        name: user.name,
        role: user.role,
      });
    } catch {
      // Fire-and-forget — email failure must not break the password reset.
    }

    return { message: "Password changed successfully" };
  }

  private async assertValidPasswordResetOtp(
    email: string,
    code: string,
  ): Promise<{ user: User; otp: Otp }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await authRepository.findUserByEmail(normalizedEmail);
    if (
      !user ||
      !user.passwordHash ||
      !PASSWORD_LOGIN_ROLES.includes(user.role)
    ) {
      throw AuthError.otpInvalid();
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw await this.accountSuspendedError(user);
    }

    const otp = await authRepository.findLatestOtp(
      user.id,
      OtpType.PASSWORD_RESET,
    );
    if (!otp) {
      throw AuthError.otpInvalid();
    }

    if (new Date() > otp.expiresAt) {
      throw AuthError.otpExpired();
    }

    if (!this.shouldRelaxAuthLimits && otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw AuthError.otpMaxAttempts();
    }

    const normalizedCode = code.trim();
    const isFixedOtpMatch =
      this.fixedOtpCode != null &&
      normalizedCode == this.fixedOtpCode &&
      this.shouldUseFixedOtpForEmail(normalizedEmail);
    const isValid =
      isFixedOtpMatch || (await verifyOtpHash(normalizedCode, otp.code));
    if (!isValid) {
      await authRepository.incrementOtpAttempts(otp.id);
      throw AuthError.otpInvalid();
    }

    return { user, otp };
  }

  async resendOtp(email: string): Promise<{ message: string }> {
    return this.sendOtp(email);
  }

  /**
   * Request a password reset email. Always returns success — never reveals
   * whether the email is registered (prevents enumeration). Only sends an
   * actual email when the user exists, is active, and has a password-login role.
   */
  async requestPasswordReset(
    email: string,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const genericMessage =
      "If the email matches a SoftLogic account, a password reset link has been sent.";
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return { message: genericMessage };
    }

    const user = await authRepository.findUserByEmail(normalizedEmail);
    if (
      !user ||
      user.deletedAt ||
      user.status !== UserStatus.ACTIVE ||
      !PASSWORD_LOGIN_ROLES.includes(user.role)
    ) {
      return { message: genericMessage };
    }

    try {
      await writeAuditLog({
        actorUserId: user.id,
        action: "auth.password_reset.request",
        targetType: "user",
        targetId: user.id,
        summary: "User requested a password reset",
        ip: ipAddress,
      });
    } catch {
      // Never block the request on audit failure.
    }

    const token = await this.createPasswordResetToken(user.id);
    const resetUrl = this.passwordResetUrl(token);
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      role: user.role,
      resetUrl,
      expiresInLabel: `${PASSWORD_RESET_EXPIRY_HOURS} hours`,
    });

    return { message: genericMessage };
  }

  private async createPasswordResetToken(userId: string): Promise<string> {
    // Invalidate any outstanding setup/reset tokens for this user so only the
    // newest link works.
    await prisma.otp.updateMany({
      where: { userId, type: OtpType.PASSWORD_RESET, usedAt: null },
      data: { usedAt: new Date() },
    });

    const secret = randomBytes(32).toString("hex");
    const otp = await prisma.otp.create({
      data: {
        userId,
        type: OtpType.PASSWORD_RESET,
        code: await bcrypt.hash(secret, 10),
        expiresAt: new Date(
          Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000,
        ),
      },
    });
    return `${otp.id}.${secret}`;
  }

  private passwordResetUrl(token: string): string {
    const baseUrl = (env.PUBLIC_ADMIN_URL || env.PUBLIC_APP_URL).replace(
      /\/+$/,
      "",
    );
    return `${baseUrl}/setup-password?token=${encodeURIComponent(token)}&mode=reset`;
  }

  /**
   * Human-readable expiry label for password setup links, derived from the
   * canonical TTL constant so copy stays in sync with the actual token TTL.
   */
  get passwordSetupExpiryLabel(): string {
    const days: number = PASSWORD_SETUP_EXPIRY_DAYS;
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  private parsePasswordSetupToken(token: string): {
    otpId: string;
    secret: string;
  } {
    const [otpId, secret, ...rest] = token.trim().split(".");
    if (!otpId || !secret || rest.length > 0) {
      throw new AppError("Password setup link is invalid or expired", 400);
    }

    return { otpId, secret };
  }

  private get fixedOtpCode(): string | null {
    if (this.isProductionMode || !env.DEV_FIXED_OTP_ENABLED) {
      return null;
    }

    return env.DEV_FIXED_OTP_CODE ?? FALLBACK_FIXED_OTP;
  }

  private get fixedOtpAllowedEmails(): Set<string> {
    if (this.isProductionMode || !env.DEV_FIXED_OTP_ENABLED) {
      return new Set<string>();
    }

    return new Set(
      (env.DEV_FIXED_OTP_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private get shouldRelaxAuthLimits(): boolean {
    return env.TESTING_RELAX_AUTH_LIMITS;
  }

  private shouldUseFixedOtpForEmail(email: string): boolean {
    if (this.fixedOtpCode == null) {
      return false;
    }

    if (this.shouldRelaxAuthLimits) {
      return true;
    }

    if (!(this.isDevelopmentMode || this.isTestMode)) {
      return false;
    }

    return this.fixedOtpAllowedEmails.has(email);
  }

  private get isDevelopmentMode(): boolean {
    return env.NODE_ENV === "development";
  }

  private get isProductionMode(): boolean {
    return env.NODE_ENV === "production";
  }

  private get isTestMode(): boolean {
    return env.NODE_ENV === "test";
  }

  private ensureGoogleDesktopAuthConfigured(): void {
    if (
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET ||
      !env.GOOGLE_OAUTH_REDIRECT_URI
    ) {
      throw new AppError(
        "Google desktop sign-in is not configured on the server.",
        503,
      );
    }
  }

  private buildGoogleDesktopAuthUrl(state: string): string {
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
    authUrl.searchParams.set("redirect_uri", env.GOOGLE_OAUTH_REDIRECT_URI!);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "select_account");
    authUrl.searchParams.set("state", state);
    return authUrl.toString();
  }

  private async exchangeGoogleCodeForIdToken(code: string): Promise<string> {
    const payload = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI!,
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      body: payload,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    const body = (await response.json()) as GoogleTokenExchangeResponse;
    if (!response.ok) {
      throw new AppError(
        body.error_description?.trim() ||
          body.error?.trim() ||
          "Unable to complete Google sign-in with Google.",
        502,
      );
    }

    if (!body.id_token?.trim()) {
      throw new AppError("Google sign-in did not return an ID token.", 502);
    }

    return body.id_token.trim();
  }

  private async expireAttemptIfNeeded(
    attempt: GoogleDesktopAuthAttempt,
  ): Promise<GoogleDesktopAuthAttempt | null> {
    if (
      attempt.status !== GoogleDesktopAuthAttemptStatus.PENDING ||
      new Date() <= attempt.expiresAt
    ) {
      return null;
    }

    return authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
      errorMessage: "Google sign-in session expired. Please try again.",
      status: GoogleDesktopAuthAttemptStatus.EXPIRED,
    });
  }

  private serializeAuthResponse(response: AuthResponse): Prisma.JsonObject {
    return JSON.parse(JSON.stringify(response)) as Prisma.JsonObject;
  }

  private deserializeAuthResponse(
    payload: Prisma.JsonValue | null,
  ): AuthResponse | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    return payload as unknown as AuthResponse;
  }

  private getDesktopGoogleFailureMessage(error: unknown): string {
    if (error instanceof AppError) {
      return error.message;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return "Google sign-in could not be completed. Please try again.";
  }

  private renderDesktopGoogleCallbackPage(params: {
    message: string;
    statusCode: number;
    title: string;
    variant: DesktopGoogleCallbackVariant;
  }): DesktopGoogleCallbackPageResponse {
    const classNames = {
      success: {
        cardBorder: "rgba(15, 157, 88, 0.16)",
      },
      warning: {
        cardBorder: "rgba(245, 158, 11, 0.18)",
      },
      error: {
        cardBorder: "rgba(216, 58, 58, 0.16)",
      },
    }[params.variant];
    const escapedTitle = this.escapeHtml(params.title);
    const escapedMessage = this.escapeHtml(params.message);
    const logoDataUri = this.getDesktopGoogleCallbackLogoDataUri();
    const brandSection = logoDataUri
      ? `<div class="brand"><img src="${logoDataUri}" alt="SoftLogic" class="brand-logo" /></div>`
      : "";
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SoftLogic Sign-in</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", Arial, sans-serif;
        background: #f5f7fb;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px 16px;
        color: #111827;
      }
      .shell {
        width: min(100%, 460px);
      }
      .card {
        width: 100%;
        background: #ffffff;
        border-radius: 24px;
        padding: 28px 24px 22px;
        border: 1px solid ${classNames.cardBorder};
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
        text-align: center;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #1149b5;
        border-radius: 999px;
        padding: 12px 20px;
        margin-bottom: 18px;
      }
      .brand-logo {
        display: block;
        height: 24px;
        width: auto;
      }
      h2 {
        margin: 0;
        font-size: clamp(28px, 5vw, 36px);
        line-height: 1.1;
        letter-spacing: -0.04em;
        font-weight: 700;
        color: #101828;
      }
      .lead {
        margin: 12px auto 0;
        color: #445469;
        font-size: 15px;
        line-height: 1.55;
        max-width: 320px;
      }
      .footer-note {
        margin-top: 18px;
        color: #98a2b3;
        font-size: 13px;
        line-height: 1.5;
      }
      @media (max-width: 640px) {
        body {
          padding: 16px 12px;
        }
        .card {
          padding: 24px 18px 20px;
        }
        .brand-logo {
          height: 22px;
        }
        h2 {
          font-size: 26px;
        }
        .lead {
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="card">
        ${brandSection}
        <h2>${escapedTitle}</h2>
        <p class="lead">${escapedMessage}</p>
        <p class="footer-note">You may now close this page.</p>
      </section>
    </main>
  </body>
</html>`;

    return {
      html,
      statusCode: params.statusCode,
    };
  }

  private getDesktopGoogleCallbackLogoDataUri(): string {
    if (desktopGoogleCallbackLogoDataUri) {
      return desktopGoogleCallbackLogoDataUri;
    }

    const candidatePaths = [
      resolve(
        process.cwd(),
        "src",
        "modules",
        "auth",
        "assets",
        "softlogic-logo.png",
      ),
      resolve(__dirname, "assets", "softlogic-logo.png"),
    ];

    for (const candidatePath of candidatePaths) {
      if (existsSync(candidatePath)) {
        desktopGoogleCallbackLogoDataUri = `data:image/png;base64,${readFileSync(candidatePath).toString("base64")}`;
        return desktopGoogleCallbackLogoDataUri;
      }
    }

    return "";
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private renderDesktopGoogleCallbackIcon(
    variant: DesktopGoogleCallbackVariant,
  ): string {
    if (variant === "success") {
      return `
        <svg viewBox="0 0 48 48" role="presentation">
          <path d="M14 24.5l7 7 13-15" />
          <path d="M24 8c8.8 0 16 7.2 16 16s-7.2 16-16 16S8 32.8 8 24 15.2 8 24 8" />
        </svg>
      `;
    }

    if (variant === "warning") {
      return `
        <svg viewBox="0 0 48 48" role="presentation">
          <path d="M24 9l15 26H9L24 9z" />
          <path d="M24 18v9" />
          <path d="M24 31h.01" />
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 48 48" role="presentation">
        <path d="M16 16l16 16" />
        <path d="M32 16L16 32" />
        <path d="M24 8c8.8 0 16 7.2 16 16s-7.2 16-16 16S8 32.8 8 24 15.2 8 24 8" />
      </svg>
    `;
  }
}

export const authService = new AuthService();
