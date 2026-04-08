import { SafeUserContext } from '@/modules/users/user-context.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  tokens: AuthTokens;
  user: SafeUserContext;
}

export interface GoogleUserInfo {
  email: string;
  name: string | null;
  picture: string | null;
  sub: string;
}

export interface DesktopGoogleAuthStartResponse {
  attemptId: string;
  authUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
}

export interface DesktopGoogleAuthStatusResponse {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  message?: string;
  session?: AuthResponse;
}
