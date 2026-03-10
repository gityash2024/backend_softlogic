import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '@/shared/utils/jwt';
import { AuthError } from '@/shared/errors/AuthError';

export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AuthError.invalidCredentials();
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw AuthError.invalidCredentials();
    }

    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof AuthError) {
      next(error);
    } else {
      next(AuthError.tokenInvalid());
    }
  }
};

export const optionalAuthMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
      }
    }

    next();
  } catch {
    // Token invalid but optional — continue without user
    next();
  }
};

export const roleGuard = (...roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw AuthError.invalidCredentials();
    }

    if (!roles.includes(req.user.role)) {
      throw AuthError.unauthorized();
    }

    next();
  };
};
