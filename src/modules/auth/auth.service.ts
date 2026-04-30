import {
  GoogleDesktopAuthAttempt,
  GoogleDesktopAuthAttemptStatus,
  OtpType,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { env } from '@/config';
import { findUserContextById } from '@/modules/users/user-context.service';
import { AuthError } from '@/shared/errors/AuthError';
import { AppError } from '@/shared/errors/AppError';
import {
  getBrandLogoEmailAttachments,
  getOtpEmailHtml,
  sendEmail,
  sendWelcomeEmail,
} from '@/shared/utils/email';
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
let desktopGoogleCallbackLogoDataUri: string | null = null;

interface GoogleTokenExchangeResponse {
  error?: string;
  error_description?: string;
  id_token?: string;
}

interface DesktopGoogleCallbackPageResponse {
  html: string;
  statusCode: number;
}

type DesktopGoogleCallbackVariant = 'success' | 'warning' | 'error';

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
      const brandLogoAttachments = getBrandLogoEmailAttachments();
      await sendEmail({
        attachments:
          brandLogoAttachments.length > 0 ? brandLogoAttachments : undefined,
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

    await authRepository.markOtpUsed(otp.id);

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
    const googleEmail = googleUser.email.trim().toLowerCase();
    const now = new Date();

    let user = await authRepository.findUserByGoogleId(googleUser.sub);
    if (user && user.status !== UserStatus.ACTIVE) {
      throw AuthError.invalidCredentials();
    }

    if (!user) {
      const existingUser = await authRepository.findUserByEmail(googleEmail);
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
        user = await authRepository.createUser({
          avatar: googleUser.picture ?? undefined,
          email: googleEmail,
          googleId: googleUser.sub,
          isEmailVerified: true,
          lastLoginAt: now,
          name: googleUser.name,
          role: UserRole.STUDENT,
        });
        await sendWelcomeEmail({
          to: user.email,
          name: user.name,
          role: user.role,
        });
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
        message: 'This sign-in request is missing its verification state.',
        statusCode: 400,
        variant: 'warning',
        title: 'Sign-in could not be completed',
      });
    }

    const attempt = await authRepository.findGoogleDesktopAuthAttemptByState(
      state.trim(),
    );
    if (!attempt) {
      return this.renderDesktopGoogleCallbackPage({
        message: 'This sign-in request could not be found.',
        statusCode: 404,
        variant: 'warning',
        title: 'We could not find this sign-in request',
      });
    }

    const expiredAttempt = await this.expireAttemptIfNeeded(attempt);
    if (expiredAttempt) {
      return this.renderDesktopGoogleCallbackPage({
        message: 'This sign-in request has expired.',
        statusCode: 410,
        variant: 'warning',
        title: 'Your sign-in link has expired',
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
        variant: 'warning',
        title: 'Sign-in cancelled',
      });
    }

    if (!code?.trim()) {
      await authRepository.updateGoogleDesktopAuthAttempt(attempt.id, {
        errorMessage: 'Google did not return an authorization code.',
        status: GoogleDesktopAuthAttemptStatus.FAILED,
      });
      return this.renderDesktopGoogleCallbackPage({
        message: 'Google did not return an authorization code.',
        statusCode: 400,
        variant: 'error',
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
        message: 'Google sign-in is complete.',
        statusCode: 200,
        variant: 'success',
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
        variant: 'error',
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
      const session = await authRepository.findSessionByToken(refreshToken);
      if (!session) {
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

  private shouldUseFixedOtpForEmail(email: string): boolean {
    if (this.fixedOtpCode == null) {
      return false;
    }

    if (this.shouldRelaxAuthLimits) {
      return true;
    }

    return this.fixedOtpAllowedEmails.has(email);
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
    title: string;
    variant: DesktopGoogleCallbackVariant;
  }): DesktopGoogleCallbackPageResponse {
    const classNames = {
      success: {
        cardBorder: 'rgba(15, 157, 88, 0.16)',
      },
      warning: {
        cardBorder: 'rgba(245, 158, 11, 0.18)',
      },
      error: {
        cardBorder: 'rgba(216, 58, 58, 0.16)',
      },
    }[params.variant];
    const escapedTitle = this.escapeHtml(params.title);
    const escapedMessage = this.escapeHtml(params.message);
    const logoDataUri = this.getDesktopGoogleCallbackLogoDataUri();
    const brandSection = logoDataUri
      ? `<div class="brand"><img src="${logoDataUri}" alt="SoftLogic" class="brand-logo" /></div>`
      : '';
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
      resolve(process.cwd(), 'src', 'modules', 'auth', 'assets', 'softlogic-logo.png'),
      resolve(__dirname, 'assets', 'softlogic-logo.png'),
    ];

    for (const candidatePath of candidatePaths) {
      if (existsSync(candidatePath)) {
        desktopGoogleCallbackLogoDataUri = `data:image/png;base64,${readFileSync(candidatePath).toString('base64')}`;
        return desktopGoogleCallbackLogoDataUri;
      }
    }

    return '';
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private renderDesktopGoogleCallbackIcon(
    variant: DesktopGoogleCallbackVariant,
  ): string {
    if (variant === 'success') {
      return `
        <svg viewBox="0 0 48 48" role="presentation">
          <path d="M14 24.5l7 7 13-15" />
          <path d="M24 8c8.8 0 16 7.2 16 16s-7.2 16-16 16S8 32.8 8 24 15.2 8 24 8" />
        </svg>
      `;
    }

    if (variant === 'warning') {
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
