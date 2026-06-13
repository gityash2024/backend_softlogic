import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '@/shared/errors/AppError';
import { ValidationError } from '@/shared/errors/ValidationError';
import { env } from '@/config';

export const errorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({
      success: false,
      data: null,
      message: err.message,
      errors: err.errors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      data: err.details ?? null,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const fields = Array.isArray(err.meta?.target)
      ? err.meta.target.map(String)
      : [];
    const message = fields.includes('slug')
      ? 'Organization slug already exists'
      : fields.includes('email')
        ? 'Email already exists'
        : 'A record with these details already exists';
    res.status(409).json({
      success: false,
      data: null,
      message,
    });
    return;
  }

  // Unhandled errors
  console.error('🔥 Unhandled Error:', err);

  res.status(500).json({
    success: false,
    data: null,
    message: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};
