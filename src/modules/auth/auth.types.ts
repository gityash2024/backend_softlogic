import { User, Session, Otp, UserRole } from '@prisma/client';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  tokens: AuthTokens;
  user: SafeUser;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: UserRole;
  isEmailVerified: boolean;
  timezone: string;
  language: string;
  createdAt: Date;
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture: string;
  sub: string; // Google user ID
}

export const toSafeUser = (user: User): SafeUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatar: user.avatar,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  timezone: user.timezone,
  language: user.language,
  createdAt: user.createdAt,
});
