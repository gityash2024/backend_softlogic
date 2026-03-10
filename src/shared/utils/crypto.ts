import crypto from 'crypto';

export const generateRandomToken = (length = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

export const hashSha256 = (data: string): string => {
  return crypto.createHash('sha256').update(data).digest('hex');
};
