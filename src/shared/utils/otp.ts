import crypto from 'crypto';
import bcrypt from 'bcrypt';

const OTP_LENGTH = 4;
const SALT_ROUNDS = 12;

export const generateOtp = (): string => {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return crypto.randomInt(min, max).toString();
};

export const hashOtp = async (otp: string): Promise<string> => {
  return bcrypt.hash(otp, SALT_ROUNDS);
};

export const verifyOtp = async (otp: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(otp, hash);
};
