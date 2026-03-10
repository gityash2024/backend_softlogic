/* eslint-disable @typescript-eslint/no-namespace */
import { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
      } & JwtPayload;
    }
  }
}

export {};
