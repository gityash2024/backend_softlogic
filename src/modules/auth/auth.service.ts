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
        badge: 'Request issue',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'Start Google sign-in again.',
        ],
        supportText: '',
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
        badge: 'Request not found',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'Start Google sign-in again.',
        ],
        supportText: '',
        message: 'This sign-in request could not be found.',
        statusCode: 404,
        variant: 'warning',
        title: 'We could not find this sign-in request',
      });
    }

    const expiredAttempt = await this.expireAttemptIfNeeded(attempt);
    if (expiredAttempt) {
      return this.renderDesktopGoogleCallbackPage({
        badge: 'Request expired',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'Start Google sign-in again.',
        ],
        supportText: '',
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
        badge: 'Cancelled',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'Use Google sign-in again when you are ready.',
        ],
        supportText: '',
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
        badge: 'Missing authorization',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'Try Google sign-in again.',
        ],
        supportText: '',
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
        badge: 'Signed in',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'You can close this tab.',
        ],
        supportText: '',
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
        badge: 'Sign-in failed',
        nextSteps: [
          'Return to the SoftLogic desktop app.',
          'Try Google sign-in again.',
        ],
        supportText: '',
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
    badge: string;
    message: string;
    nextSteps: string[];
    statusCode: number;
    supportText: string;
    title: string;
    variant: DesktopGoogleCallbackVariant;
  }): DesktopGoogleCallbackPageResponse {
    const classNames = {
      success: {
        accent: '#0F9D58',
        badgeBackground: 'rgba(15, 157, 88, 0.12)',
        badgeText: '#0B7A43',
        halo: 'rgba(15, 157, 88, 0.12)',
        cardBorder: 'rgba(15, 157, 88, 0.12)',
        iconBackground:
          'linear-gradient(180deg, rgba(15, 157, 88, 0.1), rgba(66, 133, 244, 0.06))',
        iconStroke: '#0F9D58',
      },
      warning: {
        accent: '#F59E0B',
        badgeBackground: 'rgba(245, 158, 11, 0.14)',
        badgeText: '#B76800',
        halo: 'rgba(245, 158, 11, 0.12)',
        cardBorder: 'rgba(245, 158, 11, 0.14)',
        iconBackground:
          'linear-gradient(180deg, rgba(245, 158, 11, 0.1), rgba(251, 191, 36, 0.06))',
        iconStroke: '#D97706',
      },
      error: {
        accent: '#D83A3A',
        badgeBackground: 'rgba(216, 58, 58, 0.14)',
        badgeText: '#B42318',
        halo: 'rgba(216, 58, 58, 0.12)',
        cardBorder: 'rgba(216, 58, 58, 0.14)',
        iconBackground:
          'linear-gradient(180deg, rgba(216, 58, 58, 0.1), rgba(242, 113, 113, 0.06))',
        iconStroke: '#D83A3A',
      },
    }[params.variant];
    const escapedTitle = this.escapeHtml(params.title);
    const escapedMessage = this.escapeHtml(params.message);
    const escapedBadge = this.escapeHtml(params.badge);
    const escapedSupportText = this.escapeHtml(params.supportText);
    const nextStepsHtml = params.nextSteps
      .map((step, index) => {
        const escapedStep = this.escapeHtml(step);
        return `<li><span class="step-index">0${index + 1}</span><span>${escapedStep}</span></li>`;
      })
      .join('');
    const nextStepsSection = nextStepsHtml
      ? `
          <div class="panel">
            <p class="panel-title">Next</p>
            <ol class="steps">${nextStepsHtml}</ol>
          </div>
        `
      : '';
    const supportSection = params.supportText.trim()
      ? `<p class="support">${escapedSupportText}</p>`
      : '';
    const icon = this.renderDesktopGoogleCallbackIcon(params.variant);
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
        background:
          radial-gradient(circle at top left, rgba(68, 132, 255, 0.22), transparent 26%),
          linear-gradient(160deg, #0a367f 0%, #1149b5 58%, #0a2d73 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        color: #111827;
      }
      .shell {
        width: min(100%, 560px);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
        color: #ffffff;
      }
      .brand-mark {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.18);
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(14px);
      }
      .brand-mark svg {
        width: 24px;
        height: 24px;
      }
      .brand-copy {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .brand-copy strong {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .brand-copy span {
        font-size: 11px;
        color: rgba(226, 232, 245, 0.8);
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .card {
        position: relative;
        overflow: hidden;
        width: 100%;
        background: rgba(255, 255, 255, 0.96);
        border-radius: 28px;
        padding: 28px 28px 24px;
        border: 1px solid ${classNames.cardBorder};
        box-shadow:
          0 24px 60px rgba(4, 25, 68, 0.22),
          0 4px 18px rgba(4, 25, 68, 0.08);
        backdrop-filter: blur(18px);
      }
      .card::before {
        content: "";
        position: absolute;
        top: -100px;
        right: -80px;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        background: ${classNames.halo};
        filter: blur(4px);
      }
      .card-inner {
        position: relative;
        z-index: 1;
        text-align: center;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        background: ${classNames.badgeBackground};
        color: ${classNames.badgeText};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .badge::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: ${classNames.accent};
      }
      .status-grid {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        margin-top: 20px;
      }
      .status-icon {
        width: 72px;
        height: 72px;
        border-radius: 22px;
        background: ${classNames.iconBackground};
        border: 1px solid rgba(17, 24, 39, 0.06);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
      }
      .status-icon svg {
        width: 36px;
        height: 36px;
        stroke: ${classNames.iconStroke};
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2.2;
      }
      h2 {
        margin: 0;
        font-size: clamp(28px, 4vw, 38px);
        line-height: 1.08;
        letter-spacing: -0.04em;
        font-weight: 700;
        color: #101828;
      }
      .lead {
        margin: 14px auto 0;
        color: #445469;
        font-size: 16px;
        line-height: 1.6;
        max-width: 420px;
      }
      .panel {
        margin-top: 22px;
        padding: 16px;
        border-radius: 18px;
        background: rgba(244, 247, 252, 0.96);
        border: 1px solid rgba(217, 226, 240, 0.8);
        text-align: left;
      }
      .panel-title {
        margin: 0 0 12px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #667085;
      }
      .steps {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 12px;
      }
      .steps li {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px;
        align-items: start;
        color: #344054;
        font-size: 14px;
        line-height: 1.5;
      }
      .step-index {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        background: rgba(17, 73, 181, 0.1);
        color: #1149b5;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .support {
        margin-top: 18px;
        color: #667085;
        font-size: 14px;
        line-height: 1.55;
      }
      .footer-note {
        margin-top: 16px;
        color: #98a2b3;
        font-size: 13px;
        line-height: 1.5;
      }
      @media (max-width: 640px) {
        body {
          padding: 18px 12px;
        }
        .card {
          padding: 22px 18px 20px;
        }
        .brand {
          margin-bottom: 14px;
        }
        .status-icon {
          width: 64px;
          height: 64px;
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
      <div class="brand" aria-hidden="true">
        <div class="brand-mark">
          <svg viewBox="0 0 48 48" role="presentation">
            <circle cx="24" cy="14" r="6" stroke="rgba(255,255,255,0.95)" />
            <circle cx="12" cy="24" r="5" stroke="rgba(255,255,255,0.85)" />
            <circle cx="36" cy="24" r="5" stroke="rgba(255,255,255,0.85)" />
            <path d="M18 33c0-3.5 2.7-6 6-6s6 2.5 6 6" />
            <path d="M6.5 34c0-3.2 2.3-5.5 5.5-5.5 1.8 0 3.4.7 4.5 2" />
            <path d="M31.5 30.5c1.1-1.3 2.7-2 4.5-2 3.2 0 5.5 2.3 5.5 5.5" />
          </svg>
        </div>
        <div class="brand-copy">
          <strong>SoftLogic</strong>
          <span>Desktop sign-in</span>
        </div>
      </div>
      <section class="card">
        <div class="card-inner">
          <div class="badge">${escapedBadge}</div>
          <div class="status-grid">
            <div class="status-icon" aria-hidden="true">${icon}</div>
            <h2>${escapedTitle}</h2>
          </div>
          <p class="lead">${escapedMessage}</p>
          ${nextStepsSection}
          ${supportSection}
          <p class="footer-note">
            You may now close this page.
          </p>
        </div>
      </section>
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
