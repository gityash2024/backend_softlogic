import request from 'supertest';

import { createApp } from '@/app';
import { authService } from '@/modules/auth/auth.service';

jest.mock('@/modules/auth/auth.service', () => ({
  authService: {
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    adminLogin: jest.fn(),
    portalLogin: jest.fn(),
    googleSignIn: jest.fn(),
    startDesktopGoogleSignIn: jest.fn(),
    handleDesktopGoogleCallback: jest.fn(),
    getDesktopGoogleSignInStatus: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
    resendOtp: jest.fn(),
    changePasswordWithCurrent: jest.fn(),
    requestPasswordResetOtp: jest.fn(),
    verifyPasswordResetOtp: jest.fn(),
    completePasswordResetOtp: jest.fn(),
    completePasswordSetup: jest.fn(),
  },
}));

const mockedAuthService = authService as jest.Mocked<typeof authService>;

describe('Auth Module', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/send-otp', () => {
    it('should send OTP for a normalized valid email', async () => {
      mockedAuthService.sendOtp.mockResolvedValue({ message: 'OTP sent successfully' });

      const response = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ email: '  Admin@SoftlogicWhiteboard.com  ' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.sendOtp).toHaveBeenCalledWith(
        'admin@softlogicwhiteboard.com',
      );
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toEqual({
        email: ['Enter a valid email address.'],
      });
      expect(mockedAuthService.sendOtp).not.toHaveBeenCalled();
    });

    it('should reject disposable email domains', async () => {
      const response = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ email: 'demo@mailinator.com' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual({
        email: ['Disposable emails not allowed.'],
      });
      expect(mockedAuthService.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/verify-otp', () => {
    it('should apply the same email validation rule before verifying OTP', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'bad-email', code: '1234' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual({
        email: ['Enter a valid email address.'],
      });
      expect(mockedAuthService.verifyOtp).not.toHaveBeenCalled();
    });

    it('should normalize valid email before verifying OTP', async () => {
      mockedAuthService.verifyOtp.mockResolvedValue({
        user: { id: 'user-1' },
        tokens: { accessToken: 'access', refreshToken: 'refresh' },
      } as never);

      const response = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: '  Admin@SoftlogicWhiteboard.com ', code: '1234' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.verifyOtp).toHaveBeenCalledWith(
        'admin@softlogicwhiteboard.com',
        '1234',
        expect.any(String),
        expect.objectContaining({ clientType: 'unknown' }),
        null,
      );
    });
  });

  describe('POST /auth/admin/login', () => {
    it('normalizes email and calls the admin password login path', async () => {
      mockedAuthService.adminLogin.mockResolvedValue({
        user: { id: 'admin-1', role: 'SUPER_ADMIN' },
        tokens: { accessToken: 'access', refreshToken: 'refresh' },
      } as never);

      const response = await request(app)
        .post('/api/v1/auth/admin/login')
        .send({ email: '  Admin@SoftlogicWhiteboard.com ', password: 'pass1234' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.adminLogin).toHaveBeenCalledWith(
        'admin@softlogicwhiteboard.com',
        'pass1234',
        expect.any(String),
        expect.objectContaining({ clientType: 'unknown' }),
        null,
      );
      expect(mockedAuthService.portalLogin).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/portal/login', () => {
    it('normalizes email and calls the teacher/student/parent password login path', async () => {
      mockedAuthService.portalLogin.mockResolvedValue({
        user: { id: 'teacher-1', role: 'TEACHER' },
        tokens: { accessToken: 'access', refreshToken: 'refresh' },
      } as never);

      const response = await request(app)
        .post('/api/v1/auth/portal/login')
        .send({ email: '  Teacher@SoftlogicWhiteboard.com ', password: 'pass1234' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.portalLogin).toHaveBeenCalledWith(
        'teacher@softlogicwhiteboard.com',
        'pass1234',
        expect.any(String),
        expect.objectContaining({ clientType: 'unknown' }),
        null,
      );
      expect(mockedAuthService.adminLogin).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/google/desktop/start', () => {
    it('starts the desktop Google OAuth flow', async () => {
      mockedAuthService.startDesktopGoogleSignIn.mockResolvedValue({
        attemptId: 'attempt-1',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
        expiresAt: '2026-04-07T12:00:00.000Z',
        pollIntervalMs: 2000,
      });

      const response = await request(app).post('/api/v1/auth/google/desktop/start');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.attemptId).toBe('attempt-1');
      expect(mockedAuthService.startDesktopGoogleSignIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /auth/google/desktop/status/:attemptId', () => {
    it('returns desktop Google OAuth status payload', async () => {
      mockedAuthService.getDesktopGoogleSignInStatus.mockResolvedValue({
        message: 'Waiting for Google sign-in to complete.',
        status: 'pending',
      });

      const response = await request(app).get(
        '/api/v1/auth/google/desktop/status/attempt-1',
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('pending');
      expect(mockedAuthService.getDesktopGoogleSignInStatus).toHaveBeenCalledWith(
        'attempt-1',
      );
    });
  });

  describe('GET /auth/google/desktop/callback', () => {
    it('renders the backend callback HTML page', async () => {
      mockedAuthService.handleDesktopGoogleCallback.mockResolvedValue({
        html: '<html><body>Signed in</body></html>',
        statusCode: 200,
      });

      const response = await request(app).get(
        '/api/v1/auth/google/desktop/callback?code=abc&state=state-1',
      );

      expect(response.status).toBe(200);
      expect(response.text).toContain('Signed in');
      expect(mockedAuthService.handleDesktopGoogleCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'abc',
          state: 'state-1',
        }),
      );
    });
  });

  describe('POST /auth/admin/password-setup/complete', () => {
    it('accepts a short password when it includes a letter and a number', async () => {
      mockedAuthService.completePasswordSetup.mockResolvedValue({
        email: 'teacher@softlogicwhiteboard.com',
        message: 'Password set successfully',
      });

      const response = await request(app)
        .post('/api/v1/auth/admin/password-setup/complete')
        .send({
          token: 'token-with-at-least-twenty-chars',
          password: 'a1',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.completePasswordSetup).toHaveBeenCalledWith(
        {
          token: 'token-with-at-least-twenty-chars',
          password: 'a1',
        },
        expect.any(String),
      );
    });

    it('still rejects a password without a number', async () => {
      const response = await request(app)
        .post('/api/v1/auth/admin/password-setup/complete')
        .send({
          token: 'token-with-at-least-twenty-chars',
          password: 'abcdef',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual({
        password: ['Include at least one number'],
      });
      expect(mockedAuthService.completePasswordSetup).not.toHaveBeenCalled();
    });
  });

  describe('password reset OTP routes', () => {
    it('requests a password reset OTP with normalized email', async () => {
      mockedAuthService.requestPasswordResetOtp.mockResolvedValue({
        message:
          'If the email matches a SoftLogic account, a password reset code has been sent.',
      });

      const response = await request(app)
        .post('/api/v1/auth/password-reset/request-otp')
        .send({ email: '  Teacher@SoftlogicWhiteboard.com  ' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.requestPasswordResetOtp).toHaveBeenCalledWith(
        'teacher@softlogicwhiteboard.com',
        expect.any(String),
      );
    });

    it('verifies a reset OTP before allowing the password step', async () => {
      mockedAuthService.verifyPasswordResetOtp.mockResolvedValue({
        message: 'OTP verified successfully',
      });

      const response = await request(app)
        .post('/api/v1/auth/password-reset/verify-otp')
        .send({ email: 'teacher@softlogicwhiteboard.com', code: '1234' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.verifyPasswordResetOtp).toHaveBeenCalledWith(
        'teacher@softlogicwhiteboard.com',
        '1234',
      );
    });

    it('completes reset OTP password change with a strong new password', async () => {
      mockedAuthService.completePasswordResetOtp.mockResolvedValue({
        message: 'Password changed successfully',
      });

      const response = await request(app)
        .post('/api/v1/auth/password-reset/complete-otp')
        .send({
          email: 'teacher@softlogicwhiteboard.com',
          code: '1234',
          newPassword: 'newpass1',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.completePasswordResetOtp).toHaveBeenCalledWith(
        'teacher@softlogicwhiteboard.com',
        '1234',
        'newpass1',
        expect.any(String),
      );
    });

    it('changes password with current password for public reset flow', async () => {
      mockedAuthService.changePasswordWithCurrent.mockResolvedValue({
        message: 'Password changed successfully',
      });

      const response = await request(app)
        .post('/api/v1/auth/password/change-with-current')
        .send({
          email: 'teacher@softlogicwhiteboard.com',
          currentPassword: 'oldpass1',
          newPassword: 'newpass1',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockedAuthService.changePasswordWithCurrent).toHaveBeenCalledWith(
        'teacher@softlogicwhiteboard.com',
        'oldpass1',
        'newpass1',
        expect.any(String),
      );
    });
  });
});
