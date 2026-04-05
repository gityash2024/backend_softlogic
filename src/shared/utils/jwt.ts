import { randomUUID } from 'crypto';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '@/config';
import { UserRole } from '@prisma/client';

interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId?: string | null;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  });
};

export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    jwtid: randomUUID(),
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  });
};

export const verifyAccessToken = (token: string): TokenPayload & JwtPayload => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload & JwtPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload & JwtPayload => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload & JwtPayload;
};

export const generateTokenPair = (payload: TokenPayload): { accessToken: string; refreshToken: string } => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};
