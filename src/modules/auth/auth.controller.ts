import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { ApiResponse } from '@/shared/utils/api-response';

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
      const result = await authService.verifyOtp(email, code, ipAddress);
      ApiResponse.success(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  async adminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip;
      const result = await authService.adminLogin(email, password, ipAddress);
      ApiResponse.success(res, result, 'Admin login successful');
    } catch (error) {
      next(error);
    }
  }

  async googleSignIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body;
      const ipAddress = req.ip;
      const result = await authService.googleSignIn(idToken, ipAddress);
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
      const result = await authService.refreshToken(refreshToken);
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

  async resendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      const result = await authService.resendOtp(email);
      ApiResponse.success(res, result, 'OTP resent successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
