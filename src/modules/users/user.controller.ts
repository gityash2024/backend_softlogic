import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { findUserContextById } from './user-context.service';

export class UserController {
  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await findUserContextById(req.user!.userId);
      if (!user) throw new AppError('User not found', 404);
      ApiResponse.success(res, user);
    } catch (error) { next(error); }
  }

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, avatar, timezone, language } = req.body;
      const user = await prisma.user.update({
        where: { id: req.user!.userId },
        data: { name, avatar, timezone, language },
      });
      const userContext = await findUserContextById(user.id);
      ApiResponse.success(res, userContext, 'Profile updated');
    } catch (error) { next(error); }
  }

  async deleteMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { deletedAt: new Date() },
      });
      ApiResponse.success(res, null, 'Account deleted');
    } catch (error) { next(error); }
  }
}

export const userController = new UserController();
