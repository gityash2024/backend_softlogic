import {
  GoogleDesktopAuthAttempt,
  GoogleDesktopAuthAttemptStatus,
  OtpType,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';

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
import {
  AuthResponse,
  DesktopGoogleAuthStartResponse,
  DesktopGoogleAuthStatusResponse,
} from './auth.types';
import { googleStrategy } from './strategies/google.strategy';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const MAX_OTP_SENDS_PER_HOUR = 3;
const FALLBACK_FIXED_OTP = '1234';
const GOOGLE_DESKTOP_AUTH_EXPIRY_MINUTES = 10;
const GOOGLE_DESKTOP_POLL_INTERVAL_MS = 2000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface GoogleTokenExchangeResponse {
  error?: string;
  error_description?: string;
  id_token?: string;
}

interface DesktopGoogleCallbackPageResponse {
  html: string;
  statusCode: number;
}

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
    if (!idToken.trim()) {
      throw new AppError('Google ID token is required', 400);
    }

    const googleUser = await googleStrategy.verifyIdToken(idToken);
    const now = new Date();

    let user = await authRepository.findUserByGoogleId(googleUser.sub);
    if (user && user.status !== UserStatus.ACTIVE) {
      throw AuthError.invalidCredentials();
    }

    if (!user) {
      const existingUser = await authRepository.findUserByEmail(googleUser.email);
      if (existingUser && existingUser.status !== UserStatus.ACTIVE) {
        throw AuthError.invalidCredentials();
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
        throw new AppError(
          'This Google account is not invited. Contact your administrator.',
          403,
        );
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
    error?: string;
    errorDescription?: string;
    ipAddress?: string;
    state?: string;
  }): Promise<DesktopGoogleCallbackPageResponse> {
    this.ensureGoogleDesktopAuthConfigured();

    const { code, error, errorDescription, ipAddress, state } = params;
    if (!state?.trim()) {
      return this.renderDesktopGoogleCallbackPage({
        message: 'The Google sign-in request is missing its verification state.',
        statusCode: 400,
        success: false,
        title: 'Sign-in could not be completed',
      });
    }

    const attempt = await authRepository.findGoogleDesktopAuthAttemptByState(
      state.trim(),
    );
    if (!attempt) {
      return this.renderDesktopGoogleCallbackPage({
        message:
          'This Google sign-in request could not be found. Please return to the app and try again.',
        statusCode: 404,
        success: false,
        title: 'Sign-in request not found',
      });
    }

    const expiredAttempt = await this.expireAttemptIfNeeded(attempt);
    if (expiredAttempt) {
      return this.renderDesktopGoogleCallbackPage({
        message:
          'This Google sign-in request has expired. Please return to the app and start again.',
        statusCode: 410,
        success: false,
        title: 'Sign-in request expired',
      });
    }

    if (error?.trim()) {
      const message =
        errorDescription?.trim() ||
        'Google sign-in was cancelled before it completed.';
      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        errorMessage: message,
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return this.renderDesktopGoogleCallbackPage({
        message,
        statusCode: 400,
        success: false,
        title: 'Sign-in cancelled',
      });
    }

    if (!code?.trim()) {
      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        errorMessage: 'Google did not return an authorization code.',
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return this.renderDesktopGoogleCallbackPage({
        message:
          'Google did not return an authorization code. Please return to the app and try again.',
        statusCode: 400,
        success: false,
        title: 'Sign-in could not be completed',
      });
    }

    try {
      const idToken = await this.exchangeGoogleCodeForIdToken(code.trim());
      const session = await this.googleSignIn(idToken, ipAddress);

      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        completedAt: new Date(),
        errorMessage: null,
        sessionPayload: this.serializeAuthResponse(session),
        status: GoogleDesktopAuthAttemptStatus.COMPLETED,
        user: { connect: { id: session.user.id } },
      });

      return this.renderDesktopGoogleCallbackPage({
        message:
          'Google sign-in is complete. You can return to the SoftLogic desktop app now.',
        statusCode: 200,
        success: true,
        title: 'You are signed in',
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
        success: false,
        title: 'Sign-in failed',
      });
    }
  }

  async getDesktopGoogleSignInStatus(
    attemptId: string,
  ): Promise<DesktopGoogleAuthStatusResponse> {
    const attempt = await authRepository.findGoogleDesktopAuthAttemptById(attemptId);
    if (!attempt) {
      throw new AppError('Google sign-in session was not found.', 404);
    }

    const refreshedAttempt = (await this.expireAttemptIfNeeded(attempt)) ?? attempt;

    if (refreshedAttempt.status === GoogleDesktopAuthAttemptStatus.PENDING) {
      return {
        message: 'Waiting for Google sign-in to complete.',
        status: 'pending',
      };
    }

    if (refreshedAttempt.status === GoogleDesktopAuthAttemptStatus.EXPIRED) {
      return {
        message:
          refreshedAttempt.errorMessage ??
          'Google sign-in session expired. Please try again.',
        status: 'expired',
      };
    }

    if (refreshedAttempt.status === GoogleDesktopAuthAttemptStatus.FAILED) {
      return {
        message:
          refreshedAttempt.errorMessage ?? 'Google sign-in could not be completed.',
        status: 'failed',
      };
    }

    if (refreshedAttempt.consumedAt) {
      return {
        message:
          'Google sign-in has already been completed for this request. Please start again if needed.',
        status: 'failed',
      };
    }

    const session = this.deserializeAuthResponse(refreshedAttempt.sessionPayload);
    if (!session) {
      await authRepository.updateGoogleDesktopAuthAttempt(refreshedAttempt.id, {
        errorMessage: 'Google sign-in finished without a valid session payload.',
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return {
        message: 'Google sign-in finished without a valid session payload.',
        status: 'failed',
      };
    }

    const consumed = await authRepository.consumeGoogleDesktopAuthAttempt(
      refreshedAttempt.id,
      new Date(),
    );
    if (!consumed) {
      return {
        message:
          'Google sign-in has already been completed for this request. Please start again if needed.',
        status: 'failed',
      };
    }

    return {
      message: 'Google sign-in completed successfully.',
      session,
      status: 'completed',
    };
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

  private ensureGoogleDesktopAuthConfigured(): void {
    if (
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET ||
      !env.GOOGLE_OAUTH_REDIRECT_URI
    ) {
      throw new AppError(
        'Google desktop sign-in is not configured on the server.',
        503,
      );
    }
  }

  private buildGoogleDesktopAuthUrl(state: string): string {
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
    authUrl.searchParams.set('redirect_uri', env.GOOGLE_OAUTH_REDIRECT_URI!);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('prompt', 'select_account');
    authUrl.searchParams.set('state', state);
    return authUrl.toString();
  }

  private async exchangeGoogleCodeForIdToken(code: string): Promise<string> {
    const payload = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI!,
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      body: payload,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    const body = (await response.json()) as GoogleTokenExchangeResponse;
    if (!response.ok) {
      throw new AppError(
        body.error_description?.trim() ||
          body.error?.trim() ||
          'Unable to complete Google sign-in with Google.',
        502,
      );
    }

    if (!body.id_token?.trim()) {
      throw new AppError('Google sign-in did not return an ID token.', 502);
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
      errorMessage: 'Google sign-in session expired. Please try again.',
      status: GoogleDesktopAuthAttemptStatus.EXPIRED,
    });
  }

  private serializeAuthResponse(response: AuthResponse): Prisma.JsonObject {
    return JSON.parse(JSON.stringify(response)) as Prisma.JsonObject;
  }

  private deserializeAuthResponse(
    payload: Prisma.JsonValue | null,
  ): AuthResponse | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
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

    return 'Google sign-in could not be completed. Please try again.';
  }

  private renderDesktopGoogleCallbackPage(params: {
    message: string;
    statusCode: number;
    success: boolean;
    title: string;
  }): DesktopGoogleCallbackPageResponse {
    const accent = params.success ? '#1149B5' : '#D83A3A';
    const badge = params.success ? 'Success' : 'Unable to continue';
    const escapedTitle = this.escapeHtml(params.title);
    const escapedMessage = this.escapeHtml(params.message);
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
        background: linear-gradient(180deg, #08357c 0%, #1149b5 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        color: #111827;
      }
      .card {
        width: min(100%, 480px);
        background: #ffffff;
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 24px 60px rgba(4, 25, 68, 0.28);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 999px;
        background: ${accent}1A;
        color: ${accent};
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 12px;
        font-size: 32px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: #5b6577;
        font-size: 16px;
        line-height: 1.6;
      }
      .hint {
        margin-top: 18px;
        font-size: 14px;
        color: #8d96a8;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="badge">${badge}</div>
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
      <p class="hint">You can close this browser tab and return to the desktop app.</p>
    </main>
  </body>
</html>`;

    return {
      html,
      statusCode: params.statusCode,
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

export const authService = new AuthService();
