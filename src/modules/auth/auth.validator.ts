import { z } from 'zod';

const disposableDomains = new Set([
  'tempmail.com',
  'throwaway.email',
  'mailinator.com',
  'guerrillamail.com',
  'yopmail.com',
  'sharklasers.com',
  'trashmail.com',
]);

const authEmailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$/;

const authEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((email, ctx) => {
    if (!email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email is required.',
      });
      return;
    }

    if (!authEmailRegex.test(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid email address.',
      });
      return;
    }

    const emailParts = email.split('@');
    const domain = emailParts[emailParts.length - 1];
    if (disposableDomains.has(domain)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Disposable emails not allowed.',
      });
    }
  });

export const sendOtpSchema = z.object({
  email: authEmailSchema,
});

export const verifyOtpSchema = z.object({
  email: authEmailSchema,
  code: z.string().length(4, 'OTP must be 4 digits').regex(/^\d{4}$/, 'OTP must contain only digits'),
});

export const googleSignInSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const adminLoginSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const strongPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const passwordSetupTokenSchema = z.object({
  token: z.string().trim().min(20, 'Setup token is required'),
});

export const completePasswordSetupSchema = passwordSetupTokenSchema.extend({
  password: strongPasswordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: strongPasswordSchema,
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type PasswordSetupTokenInput = z.infer<typeof passwordSetupTokenSchema>;
export type CompletePasswordSetupInput = z.infer<typeof completePasswordSetupSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
