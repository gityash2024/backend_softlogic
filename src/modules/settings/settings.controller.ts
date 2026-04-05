import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { findUserContextById } from '@/modules/users/user-context.service';
import { normalizeCustomProfanityWords } from './settings.service';

const toSettingsResponse = (
  settings: {
    recentColors?: unknown;
    favoriteColors?: unknown;
    customProfanityWords?: unknown;
    [key: string]: unknown;
  },
  subscription: unknown,
) => ({
  ...settings,
  recentColors: Array.isArray(settings.recentColors) ? settings.recentColors : [],
  favoriteColors: Array.isArray(settings.favoriteColors) ? settings.favoriteColors : [],
  customProfanityWords: normalizeCustomProfanityWords(settings.customProfanityWords),
  subscription,
});

export class SettingsController {
  async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let settings = await prisma.userSettings.findUnique({ where: { userId: req.user!.userId } });
      if (!settings) {
        settings = await prisma.userSettings.create({ data: { userId: req.user!.userId } });
      }
      const user = await findUserContextById(req.user!.userId);
      ApiResponse.success(res, toSettingsResponse(settings, user?.subscription ?? null));
    } catch (error) { next(error); }
  }

  async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = {
        ...req.body,
        customProfanityWords: req.body.customProfanityWords === undefined
          ? undefined
          : normalizeCustomProfanityWords(req.body.customProfanityWords),
      };
      const settings = await prisma.userSettings.upsert({
        where: { userId: req.user!.userId },
        update: data,
        create: { userId: req.user!.userId, ...data },
      });
      const user = await findUserContextById(req.user!.userId);
      ApiResponse.success(res, toSettingsResponse(settings, user?.subscription ?? null), 'Settings updated');
    } catch (error) { next(error); }
  }

  async getColors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: req.user!.userId },
        select: { recentColors: true, favoriteColors: true },
      });
      ApiResponse.success(res, {
        recentColors: Array.isArray(settings?.recentColors) ? settings?.recentColors : [],
        favoriteColors: Array.isArray(settings?.favoriteColors) ? settings?.favoriteColors : [],
      });
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
