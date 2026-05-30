import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import { env } from '@/config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let warnedMissingSecret = false;

const deriveKey = (): Buffer => {
  const raw = env.ACTIVATION_KEY_CIPHER_SECRET?.trim();
  if (raw && raw.length >= 32) {
    return createHash('sha256').update(raw).digest();
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      '[cipher] ACTIVATION_KEY_CIPHER_SECRET missing or too short; falling back to JWT_ACCESS_SECRET. Set a dedicated 32+ char secret for production.',
    );
  }
  return createHash('sha256').update(env.JWT_ACCESS_SECRET).digest();
};

export const encryptSecret = (plain: string): string => {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
};

export const decryptSecret = (stored: string): string => {
  const key = deriveKey();
  const buf = Buffer.from(stored, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
};

export const tryDecryptSecret = (stored: string | null | undefined): string | null => {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
};
