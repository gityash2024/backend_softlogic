import { OtpType } from '@prisma/client';
import { authRepository } from './auth.repository';
import { AuthResponse, toSafeUser } from './auth.types';
import { generateOtp, hashOtp, verifyOtp as verifyOtpHash } from '@/shared/utils/otp';
import { generateTokenPair, verifyRefreshToken } from '@/shared/utils/jwt';
import { sendEmail, getOtpEmailHtml } from '@/shared/utils/email';
import { AuthError } from '@/shared/errors/AuthError';
import { AppError } from '@/shared/errors/AppError';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_SENDS_PER_HOUR = 3;

export class AuthService {
  async sendOtp(email: string): Promise<{ message: string }> {
    // Find or create user
    let user = await authRepository.findUserByEmail(email);
    if (!user) {
      user = await authRepository.createUser({ email });
    }

    // Rate limit check
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtpCount = await authRepository.countRecentOtps(user.id, OtpType.EMAIL_LOGIN, oneHourAgo);
    if (recentOtpCount >= MAX_OTP_SENDS_PER_HOUR) {
      throw AuthError.rateLimited();
    }

    // Invalidate previous OTPs
    await authRepository.invalidateUserOtps(user.id, OtpType.EMAIL_LOGIN);

    // Generate and store OTP
    const otpCode = generateOtp();
    const hashedOtp = await hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await authRepository.createOtp({
      userId: user.id,
      code: hashedOtp,
      type: OtpType.EMAIL_LOGIN,
      expiresAt,
    });

    // Send email
    try {
      await sendEmail({
        to: email,
        subject: 'Your Softlogic Whiteboard Login Code',
        html: getOtpEmailHtml(otpCode),
      });
    } catch {
      // Log but don't fail — in dev, OTP is logged
      console.log(`🔑 OTP for ${email}: ${otpCode}`);
    }

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(email: string, code: string, ipAddress?: string): Promise<AuthResponse> {
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw AuthError.invalidCredentials();
    }

    const otp = await authRepository.findLatestOtp(user.id, OtpType.EMAIL_LOGIN);
    if (!otp) {
      throw AuthError.otpInvalid();
    }

    // Check expiry
    if (new Date() > otp.expiresAt) {
      throw AuthError.otpExpired();
    }

    // Check attempts
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw AuthError.otpMaxAttempts();
    }

    // Verify OTP
    const isValid = await verifyOtpHash(code, otp.code);
    if (!isValid) {
      await authRepository.incrementOtpAttempts(otp.id);
      throw AuthError.otpInvalid();
    }

    // Mark OTP as used
    await authRepository.markOtpUsed(otp.id);

    // Mark email as verified
    if (!user.isEmailVerified) {
      await authRepository.updateUser(user.id, { isEmailVerified: true });
    }

    // Generate tokens
    const tokenPayload = { userId: user.id, email: user.email, role: user.role };
    const tokens = generateTokenPair(tokenPayload);

    // Store session
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await authRepository.createSession({
      userId: user.id,
      refreshToken: tokens.refreshToken,
      ipAddress,
      expiresAt,
    });

    const updatedUser = await authRepository.findUserById(user.id);
    return {
      tokens,
      user: toSafeUser(updatedUser!),
    };
  }

  async googleSignIn(idToken: string, ipAddress?: string): Promise<AuthResponse> {
    // TODO: Verify Google idToken with Google API
    // For now, this is a placeholder — actual implementation requires google-auth-library
    throw new AppError('Google Sign-In not yet configured. Please use email/OTP login.', 501);
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
      if (!user) {
        throw AuthError.invalidCredentials();
      }

      // Delete old session
      await authRepository.deleteSession(session.id);

      // Generate new tokens
      const tokenPayload = { userId: user.id, email: user.email, role: user.role };
      const tokens = generateTokenPair(tokenPayload);

      // Create new session
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await authRepository.createSession({
        userId: user.id,
        refreshToken: tokens.refreshToken,
        expiresAt,
      });

      return {
        tokens,
        user: toSafeUser(user),
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw AuthError.tokenInvalid();
    }
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      await authRepository.deleteSessionByToken(refreshToken);
    } catch {
      // Session might not exist — that's OK
    }
  }

  async resendOtp(email: string): Promise<{ message: string }> {
    return this.sendOtp(email);
  }
}

export const authService = new AuthService();
