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
  name: string;
  picture: string;
  sub: string;
}
