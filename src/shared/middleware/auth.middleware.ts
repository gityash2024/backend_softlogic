import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { authRepository } from '@/modules/auth/auth.repository';
import { verifyAccessToken } from '@/shared/utils/jwt';
import { AuthError } from '@/shared/errors/AuthError';

const headerValue = (req: Request, name: string): string | undefined => {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((item) => item.trim().length > 0)?.trim();
  }
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const clientSessionIdFrom = (req: Request): string | null => {
  const value = headerValue(req, 'x-softlogic-client-session-id');
  return value && value.length >= 8 && value.length <= 128 ? value : null;
};

const assertClientSessionActive = async (
  req: Request,
  allowMissingSession: boolean,
): Promise<void> => {
  const clientSessionId = clientSessionIdFrom(req);
  if (!clientSessionId || !req.user?.userId) {
    return;
  }

  const session = await authRepository.findUserSessionByClientSessionId(
    req.user.userId,
    clientSessionId,
  );
  if (!session) {
    if (allowMissingSession) {
      return;
    }
    throw AuthError.tokenInvalid();
  }
  if (session.revokedAt || session.expiresAt <= new Date()) {
    throw AuthError.tokenInvalid();
  }
};

const authenticate = (options?: { allowMissingClientSession?: boolean }) => async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
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
    await assertClientSessionActive(
      req,
      options?.allowMissingClientSession ?? false,
    );
    next();
  } catch (error) {
    if (error instanceof AuthError) {
      next(error);
    } else {
      next(AuthError.tokenInvalid());
    }
  }
};

export const authMiddleware = authenticate();

export const authMiddlewareAllowMissingClientSession = authenticate({
  allowMissingClientSession: true,
});

export const optionalAuthMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
        await assertClientSessionActive(req, true);
      }
    }

    next();
  } catch {
    // Token invalid but optional — continue without user
    next();
  }
};

export const roleGuard = (...roles: UserRole[]) => {
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
