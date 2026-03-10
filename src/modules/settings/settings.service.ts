import { prisma } from '@/config';

export class SettingsService {
  async getByUser(userId: string) { return prisma.userSettings.findUnique({ where: { userId } }); }
}

export const settingsService = new SettingsService();
