import { OtpType, UserStatus } from '@prisma/client';

import { env } from '@/config';
import { findUserContextById } from '@/modules/users/user-context.service';
import { AuthError } from '@/shared/errors/AuthError';
import { AppError } from '@/shared/errors/AppError';
import { sendEmail, getOtpEmailHtml } from '@/shared/utils/email';
import { generateTokenPair, verifyRefreshToken } from '@/shared/utils/jwt';
import {
  generateOtp,
  hashOtp,
  verifyOtp as verifyOtpHash,
} from '@/shared/utils/otp';

import { authRepository } from './auth.repository';
import { AuthResponse } from './auth.types';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_SENDS_PER_HOUR = 3;
const FALLBACK_FIXED_OTP = '1234';

export class AuthService {
  async sendOtp(email: string): Promise<{ message: string }> {
    const user = await authRepository.findUserByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw AuthError.invalidCredentials();
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtpCount = await authRepository.countRecentOtps(
      user.id,
      OtpType.EMAIL_LOGIN,
      oneHourAgo,
    );
    if (!this.shouldRelaxAuthLimits && recentOtpCount >= MAX_OTP_SENDS_PER_HOUR) {
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
      await sendEmail({
        to: email,
        subject: 'Your Softlogic Whiteboard Login Code',
        html: getOtpEmailHtml(otpCode),
      });
    } catch {
      console.log(`OTP for ${email}: ${otpCode}`);
    }

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(
    email: string,
    code: string,
    ipAddress?: string,
  ): Promise<AuthResponse> {
    const user = await authRepository.findUserByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw AuthError.invalidCredentials();
    }

    const otp = await authRepository.findLatestOtp(user.id, OtpType.EMAIL_LOGIN);
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
      this.fixedOtpAllowedEmails.has(normalizedEmail);
    const isValid =
      isFixedOtpMatch || (await verifyOtpHash(normalizedCode, otp.code));
    if (!isValid) {
      await authRepository.incrementOtpAttempts(otp.id);
      throw AuthError.otpInvalid();
    }

    await authRepository.markOtpUsed(otp.id);

    await authRepository.updateUser(user.id, {
      isEmailVerified: true,
      lastLoginAt: new Date(),
    });

    const refreshedUser = await authRepository.findUserById(user.id);
    if (!refreshedUser) {
      throw AuthError.invalidCredentials();
    }

    const tokenPayload = {
      userId: refreshedUser.id,
      email: refreshedUser.email,
      role: refreshedUser.role,
      organizationId: refreshedUser.primaryOrganizationId,
    };
    const tokens = generateTokenPair(tokenPayload);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await authRepository.createSession({
      userId: user.id,
      refreshToken: tokens.refreshToken,
      ipAddress,
      expiresAt,
    });

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
  ): Promise<AuthResponse> {
    throw new AppError(
      'Google Sign-In not yet configured. Please use email/OTP login.',
      501,
    );
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    try {
      const decoded = verifyRefreshToken(refreshToken);

      const session = await authRepository.findSessionByToken(refreshToken);
      if (!session) {
        throw AuthError.tokenInvalid();
      }

      if (new Date() > session.expiresAt) {
        await authRepository.deleteSession(session.id);
        throw AuthError.tokenExpired();
      }

      const user = await authRepository.findUserById(decoded.userId);
      if (!user || user.status !== UserStatus.ACTIVE) {
        throw AuthError.invalidCredentials();
      }

      await authRepository.deleteSession(session.id);

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.primaryOrganizationId,
      };
      const tokens = generateTokenPair(tokenPayload);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await authRepository.createSession({
        userId: user.id,
        refreshToken: tokens.refreshToken,
        expiresAt,
      });

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

  async resendOtp(email: string): Promise<{ message: string }> {
    return this.sendOtp(email);
  }

  private get fixedOtpCode(): string | null {
    if (!env.DEV_FIXED_OTP_ENABLED) {
      return null;
    }

    return env.DEV_FIXED_OTP_CODE ?? FALLBACK_FIXED_OTP;
  }

  private get fixedOtpAllowedEmails(): Set<string> {
    if (!env.DEV_FIXED_OTP_ENABLED) {
      return new Set<string>();
    }

    return new Set(
      (env.DEV_FIXED_OTP_ALLOWED_EMAILS ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private get shouldRelaxAuthLimits(): boolean {
    return env.TESTING_RELAX_AUTH_LIMITS;
  }
}

export const authService = new AuthService();
