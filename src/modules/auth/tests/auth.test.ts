import request from 'supertest';

import { createApp } from '@/app';
import { authService } from '@/modules/auth/auth.service';

jest.mock('@/modules/auth/auth.service', () => ({
  authService: {
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    signInWithGoogle: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
    resendOtp: jest.fn(),
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
      );
    });
  });
});
