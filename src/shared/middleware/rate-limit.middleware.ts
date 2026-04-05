import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '@/config';

const shouldRelaxAuthLimits = env.TESTING_RELAX_AUTH_LIMITS;
const passthroughRateLimiter: RequestHandler = (_req, _res, next) => next();

export const globalRateLimiter = shouldRelaxAuthLimits
  ? passthroughRateLimiter
  : rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        data: null,
        message: 'Too many requests, please try again later.',
      },
    });

export const authRateLimiter = shouldRelaxAuthLimits
  ? passthroughRateLimiter
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 requests per 15 minutes
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        data: null,
        message: 'Too many authentication attempts, please try again later.',
      },
    });

export const otpRateLimiter = shouldRelaxAuthLimits
  ? passthroughRateLimiter
  : rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 OTP sends per hour per IP
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        data: null,
        message: 'Too many OTP requests. Please try again later.',
      },
    });
