import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { ApiResponse } from '@/shared/utils/api-response';
import { AuthError } from '@/shared/errors/AuthError';

const currentRefreshTokenFrom = (req: Request): string | null =>
  (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined) ??
  (typeof req.headers['x-refresh-token'] === 'string'
    ? (req.headers['x-refresh-token'] as string)
    : undefined) ??
  null;

const headerValue = (req: Request, name: string): string | undefined => {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((item) => item.trim().length > 0)?.trim();
  }
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const deviceInfoFrom = (req: Request): Record<string, string> => {
  const requestedClient = headerValue(req, 'x-softlogic-client');
  const clientType =
    requestedClient === 'flutter_app' || requestedClient === 'web_panel'
      ? requestedClient
      : 'unknown';
  const platform = headerValue(req, 'x-softlogic-platform');
  const deviceLabel = headerValue(req, 'x-softlogic-device');
  const appVersion = headerValue(req, 'x-softlogic-app-version');
  const userAgent = headerValue(req, 'user-agent');
  const label =
    deviceLabel ??
    (clientType === 'flutter_app'
      ? 'SoftLogic Whiteboard app'
      : clientType === 'web_panel'
        ? 'SoftLogic web panel'
        : undefined);

  const info: Record<string, string> = { clientType };
  if (label) info.label = label;
  if (deviceLabel) info.deviceLabel = deviceLabel;
  if (platform) info.platform = platform;
  if (appVersion) info.appVersion = appVersion;
  if (userAgent) info.userAgent = userAgent;
  return info;
};

const clientSessionIdFrom = (req: Request): string | null => {
  const header = headerValue(req, 'x-softlogic-client-session-id');
  const body =
    typeof req.body?.clientSessionId === 'string'
      ? req.body.clientSessionId.trim()
      : '';
  const value = header ?? body;
  return value && value.length >= 8 && value.length <= 128 ? value : null;
};

export class AuthController {
  async sendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      const result = await authService.sendOtp(email);
      ApiResponse.success(res, result, 'OTP sent successfully');
    } catch (error) {
      next(error);
    }
  }

  async verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, code } = req.body;
      const ipAddress = req.ip;
      const result = await authService.verifyOtp(
        email,
        code,
        ipAddress,
        deviceInfoFrom(req),
        clientSessionIdFrom(req),
      );
      ApiResponse.success(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  async adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip;
      const result = await authService.adminLogin(
        email,
        password,
        ipAddress,
        deviceInfoFrom(req),
        clientSessionIdFrom(req),
      );
      ApiResponse.success(res, result, 'Admin login successful');
    } catch (error) {
      next(error);
    }
  }

  async portalLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip;
      const result = await authService.portalLogin(
        email,
        password,
        ipAddress,
        deviceInfoFrom(req),
        clientSessionIdFrom(req),
      );
      ApiResponse.success(res, result, 'Portal login successful');
    } catch (error) {
      next(error);
    }
  }

  async googleSignIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;
      const ipAddress = req.ip;
      const result = await authService.googleSignIn(
        idToken,
        ipAddress,
        deviceInfoFrom(req),
        clientSessionIdFrom(req),
      );
      ApiResponse.success(res, result, 'Google login successful');
    } catch (error) {
      next(error);
    }
  }

  async startDesktopGoogleSignIn(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await authService.startDesktopGoogleSignIn();
      ApiResponse.success(res, result, 'Desktop Google sign-in started');
    } catch (error) {
      next(error);
    }
  }

  async googleDesktopCallback(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await authService.handleDesktopGoogleCallback({
        code: req.query.code?.toString(),
        error: req.query.error?.toString(),
        errorDescription: req.query.error_description?.toString(),
        deviceInfo: deviceInfoFrom(req),
        ipAddress: req.ip,
        state: req.query.state?.toString(),
      });

      res.status(result.statusCode).type('html').send(result.html);
    } catch (error) {
      next(error);
    }
  }

  async getDesktopGoogleSignInStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await authService.getDesktopGoogleSignInStatus(
        req.params.attemptId,
      );
      ApiResponse.success(res, result, 'Desktop Google sign-in status fetched');
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refreshToken(
        refreshToken,
        req.ip,
        deviceInfoFrom(req),
        clientSessionIdFrom(req),
      );
      ApiResponse.success(res, result, 'Token refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;
      await authService.logout(refreshToken);
      ApiResponse.success(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  async listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AuthError.invalidCredentials();
      }
      const result = await authService.listOwnSessions(
        userId,
        currentRefreshTokenFrom(req),
        {
          clientSessionId: clientSessionIdFrom(req),
          deviceInfo: deviceInfoFrom(req),
          ipAddress: req.ip,
        },
      );
      ApiResponse.success(res, result, 'Login sessions fetched');
    } catch (error) {
      next(error);
    }
  }

  async revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AuthError.invalidCredentials();
      }
      const result = await authService.revokeOwnSession(
        userId,
        req.params.id,
        currentRefreshTokenFrom(req),
        clientSessionIdFrom(req),
      );
      ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  async resendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      const result = await authService.resendOtp(email);
      ApiResponse.success(res, result, 'OTP resent successfully');
    } catch (error) {
      next(error);
    }
  }

  async heartbeatSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AuthError.invalidCredentials();
      }
      const result = await authService.heartbeatOwnSession(userId, {
        clientSessionId: clientSessionIdFrom(req),
        currentRefreshToken: currentRefreshTokenFrom(req),
        deviceInfo: deviceInfoFrom(req),
        ipAddress: req.ip,
      });
      ApiResponse.success(res, result, 'Login session updated');
    } catch (error) {
      next(error);
    }
  }

  async validatePasswordSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;
      const result = await authService.validatePasswordSetupToken(token);
      ApiResponse.success(res, result, 'Password setup token is valid');
    } catch (error) {
      next(error);
    }
  }

  async completePasswordSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body;
      const result = await authService.completePasswordSetup({ token, password }, req.ip);
      ApiResponse.success(res, result, 'Password set successfully');
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user?.userId;
      if (!userId) {
        throw AuthError.invalidCredentials();
      }
      // Preserve the caller's current session when the client supplies its
      // refresh token (body or header); otherwise all sessions are invalidated.
      const keepRefreshToken = currentRefreshTokenFrom(req);
      const result = await authService.changePassword(
        userId,
        currentPassword,
        newPassword,
        { ipAddress: req.ip, keepRefreshToken },
      );
      ApiResponse.success(res, result, 'Password changed successfully');
    } catch (error) {
      next(error);
    }
  }

  async changePasswordWithCurrent(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { email, currentPassword, newPassword } = req.body;
      const result = await authService.changePasswordWithCurrent(
        email,
        currentPassword,
        newPassword,
        req.ip,
      );
      ApiResponse.success(res, result, 'Password changed successfully');
    } catch (error) {
      next(error);
    }
  }

  async requestPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      const result = await authService.requestPasswordReset(email, req.ip);
      ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  async requestPasswordResetOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { email } = req.body;
      const result = await authService.requestPasswordResetOtp(email, req.ip);
      ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  async verifyPasswordResetOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { email, code } = req.body;
      const result = await authService.verifyPasswordResetOtp(email, code);
      ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  async completePasswordResetOtp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { email, code, newPassword } = req.body;
      const result = await authService.completePasswordResetOtp(
        email,
        code,
        newPassword,
        req.ip,
      );
      ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
