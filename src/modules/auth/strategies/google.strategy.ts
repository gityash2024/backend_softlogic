import { createPublicKey, verify as verifySignature } from 'crypto';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';

import { GoogleUserInfo } from '../auth.types';

interface GoogleJwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface GoogleJwtPayload {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  exp?: number;
  iat?: number;
  name?: string;
  picture?: string;
  sub?: string;
}

interface GoogleJwk {
  kid: string;
  kty: 'RSA';
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

interface GoogleJwkResponse {
  keys?: GoogleJwk[];
}

interface GoogleKeyCache {
  expiresAt: number;
  keys: GoogleJwk[];
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

let googleKeyCache: GoogleKeyCache | null = null;

const decodeTokenPart = <T>(value: string): T => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw new AppError('Invalid Google ID token payload', 401);
  }
};

const parseMaxAgeSeconds = (cacheControl: string | null): number => {
  if (!cacheControl) {
    return 300;
  }

  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) {
    return 300;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
};

const isEmailVerified = (value: boolean | string | undefined): boolean =>
  value === true || value === 'true';

const isAudienceValid = (audience: string | string[] | undefined): boolean => {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError('Google sign-in is not configured on the server', 503);
  }

  if (typeof audience === 'string') {
    return audience === env.GOOGLE_CLIENT_ID;
  }

  return Array.isArray(audience) && audience.includes(env.GOOGLE_CLIENT_ID);
};

const getGoogleKeys = async (): Promise<GoogleJwk[]> => {
  if (googleKeyCache && googleKeyCache.expiresAt > Date.now()) {
    return googleKeyCache.keys;
  }

  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new AppError('Unable to reach Google token verification service', 503);
  }

  const body = (await response.json()) as GoogleJwkResponse;
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new AppError('Google token verification keys are unavailable', 503);
  }

  googleKeyCache = {
    keys: body.keys,
    expiresAt: Date.now() + parseMaxAgeSeconds(response.headers.get('cache-control')) * 1000,
  };

  return body.keys;
};

export const googleStrategy = {
  name: 'google',

  async verifyIdToken(idToken: string): Promise<GoogleUserInfo> {
    const token = idToken.trim();
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AppError('Invalid Google ID token', 401);
    }

    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeTokenPart<GoogleJwtHeader>(headerPart);
    const payload = decodeTokenPart<GoogleJwtPayload>(payloadPart);

    if (header.alg !== 'RS256' || !header.kid) {
      throw new AppError('Invalid Google ID token header', 401);
    }

    if (!payload.sub || !payload.email || !GOOGLE_ISSUERS.has(payload.iss ?? '')) {
      throw new AppError('Invalid Google account information', 401);
    }

    if (!isAudienceValid(payload.aud)) {
      throw new AppError('Google token audience mismatch', 401);
    }

    if (!isEmailVerified(payload.email_verified)) {
      throw new AppError('Google account email is not verified', 401);
    }

    if (!payload.exp || payload.exp * 1000 <= Date.now()) {
      throw new AppError('Google ID token has expired', 401);
    }

    const keys = await getGoogleKeys();
    const jwk = keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) {
      googleKeyCache = null;
      throw new AppError('Unable to verify Google ID token signature', 401);
    }

    const publicKey = createPublicKey({
      key: {
        kty: 'RSA',
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    });

    const isValid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`, 'utf8'),
      publicKey,
      Buffer.from(signaturePart, 'base64url'),
    );

    if (!isValid) {
      throw new AppError('Invalid Google ID token signature', 401);
    }

    return {
      email: payload.email,
      name: payload.name?.trim() || null,
      picture: payload.picture?.trim() || null,
      sub: payload.sub,
    };
  },
};
