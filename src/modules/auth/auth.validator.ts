import { z } from 'zod';

export const sendOtpSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  code: z.string().length(4, 'OTP must be 4 digits').regex(/^\d{4}$/, 'OTP must contain only digits'),
});

export const googleSignInSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
