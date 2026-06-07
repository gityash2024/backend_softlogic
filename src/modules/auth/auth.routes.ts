import { Router } from 'express';
import { authController } from './auth.controller';
import { validate } from '@/shared/middleware/validation.middleware';
import {
  authMiddleware,
  authMiddlewareAllowMissingClientSession,
} from '@/shared/middleware/auth.middleware';
import {
  adminLoginSchema,
  changePasswordWithCurrentSchema,
  changePasswordSchema,
  completePasswordSetupSchema,
  googleSignInSchema,
  passwordResetOtpCompleteSchema,
  passwordResetOtpRequestSchema,
  passwordResetOtpVerifySchema,
  passwordResetRequestSchema,
  passwordSetupTokenSchema,
  refreshTokenSchema,
  sessionHeartbeatSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from './auth.validator';
import {
  authRateLimiter,
  otpRateLimiter,
  passwordResetEmailLimiter,
} from '@/shared/middleware/rate-limit.middleware';

const router = Router();

/**
 * @swagger
 * /auth/send-otp:
 *   post:
 *     summary: Send OTP to email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent successfully
 */
router.post('/send-otp', otpRateLimiter, validate(sendOtpSchema), authController.sendOtp);

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP and login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *                 minLength: 4
 *                 maxLength: 4
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/verify-otp', authRateLimiter, validate(verifyOtpSchema), authController.verifyOtp);

/**
 * @swagger
 * /auth/admin/login:
 *   post:
 *     summary: Admin login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 1
 *     responses:
 *       200:
 *         description: Admin login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account not authorized for admin panel access
 */
router.post('/admin/login', authRateLimiter, validate(adminLoginSchema), authController.adminLogin);
router.post('/portal/login', authRateLimiter, validate(adminLoginSchema), authController.portalLogin);

router.post(
  '/admin/password-setup/validate',
  authRateLimiter,
  validate(passwordSetupTokenSchema),
  authController.validatePasswordSetup,
);
router.post(
  '/admin/password-setup/complete',
  authRateLimiter,
  validate(completePasswordSetupSchema),
  authController.completePasswordSetup,
);
router.post(
  '/admin/password/change',
  authRateLimiter,
  authMiddleware,
  validate(changePasswordSchema),
  authController.changePassword,
);
router.post(
  '/password/change-with-current',
  authRateLimiter,
  validate(changePasswordWithCurrentSchema),
  authController.changePasswordWithCurrent,
);
router.post(
  '/admin/password-reset/request',
  authRateLimiter,
  passwordResetEmailLimiter,
  validate(passwordResetRequestSchema),
  authController.requestPasswordReset,
);
router.post(
  '/password-reset/request-otp',
  authRateLimiter,
  passwordResetEmailLimiter,
  validate(passwordResetOtpRequestSchema),
  authController.requestPasswordResetOtp,
);
router.post(
  '/password-reset/verify-otp',
  authRateLimiter,
  validate(passwordResetOtpVerifySchema),
  authController.verifyPasswordResetOtp,
);
router.post(
  '/password-reset/complete-otp',
  authRateLimiter,
  validate(passwordResetOtpCompleteSchema),
  authController.completePasswordResetOtp,
);

/**
 * @swagger
 * /auth/google:
 *   post:
 *     summary: Google OAuth sign-in
 *     tags: [Auth]
 */
router.post('/google', validate(googleSignInSchema), authController.googleSignIn);

/**
 * @swagger
 * /auth/google/desktop/start:
 *   post:
 *     summary: Start desktop Google OAuth flow
 *     tags: [Auth]
 */
router.post('/google/desktop/start', authController.startDesktopGoogleSignIn);

/**
 * @swagger
 * /auth/google/desktop/callback:
 *   get:
 *     summary: Handle desktop Google OAuth callback
 *     tags: [Auth]
 */
router.get('/google/desktop/callback', authController.googleDesktopCallback);

/**
 * @swagger
 * /auth/google/desktop/status/{attemptId}:
 *   get:
 *     summary: Poll desktop Google OAuth status
 *     tags: [Auth]
 */
router.get(
  '/google/desktop/status/:attemptId',
  authController.getDesktopGoogleSignInStatus,
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 */
router.post('/refresh', validate(refreshTokenSchema), authController.refreshToken);

router.get(
  '/sessions',
  authMiddlewareAllowMissingClientSession,
  authController.listSessions,
);
router.post(
  '/sessions/heartbeat',
  authMiddlewareAllowMissingClientSession,
  validate(sessionHeartbeatSchema),
  authController.heartbeatSession,
);
router.delete('/sessions/:id', authMiddleware, authController.revokeSession);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout and invalidate refresh token
 *     tags: [Auth]
 */
router.post('/logout', validate(refreshTokenSchema), authController.logout);

/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     summary: Resend OTP
 *     tags: [Auth]
 */
router.post('/resend-otp', otpRateLimiter, validate(sendOtpSchema), authController.resendOtp);

export const authRoutes = router;
