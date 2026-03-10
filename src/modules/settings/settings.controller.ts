import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';

export class SettingsController {
  async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let settings = await prisma.userSettings.findUnique({ where: { userId: req.user!.userId } });
      if (!settings) {
        settings = await prisma.userSettings.create({ data: { userId: req.user!.userId } });
      }
      ApiResponse.success(res, settings);
    } catch (error) { next(error); }
  }

  async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await prisma.userSettings.upsert({
        where: { userId: req.user!.userId },
        update: req.body,
        create: { userId: req.user!.userId, ...req.body },
      });
      ApiResponse.success(res, settings, 'Settings updated');
    } catch (error) { next(error); }
  }

  async getColors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: req.user!.userId },
        select: { recentColors: true, favoriteColors: true },
      });
      ApiResponse.success(res, settings || { recentColors: [], favoriteColors: [] });
    } catch (error) { next(error); }
  }

  async updateColors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { recentColors, favoriteColors } = req.body;
      const settings = await prisma.userSettings.upsert({
        where: { userId: req.user!.userId },
        update: { recentColors, favoriteColors },
        create: { userId: req.user!.userId, recentColors, favoriteColors },
      });
      ApiResponse.success(res, settings, 'Colors updated');
    } catch (error) { next(error); }
  }
}

export const settingsController = new SettingsController();
