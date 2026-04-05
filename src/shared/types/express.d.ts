/* eslint-disable @typescript-eslint/no-namespace */
import { UserRole } from '@prisma/client';
import { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: UserRole;
        organizationId?: string | null;
      } & JwtPayload;
    }
  }
}

export {};
