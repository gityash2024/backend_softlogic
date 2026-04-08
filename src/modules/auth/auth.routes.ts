import { Router } from 'express';
import { authController } from './auth.controller';
import { validate } from '@/shared/middleware/validation.middleware';
import { sendOtpSchema, verifyOtpSchema, googleSignInSchema, refreshTokenSchema } from './auth.validator';
import { authRateLimiter, otpRateLimiter } from '@/shared/middleware/rate-limit.middleware';

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
