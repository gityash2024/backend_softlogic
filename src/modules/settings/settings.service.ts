import { prisma } from '@/config';

export class SettingsService {
  async getByUser(userId: string) { return prisma.userSettings.findUnique({ where: { userId } }); }
}

const customProfanityWordLimit = 100;

export const normalizeCustomProfanityWords = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    const word = entry?.toString().trim();
    if (!word) {
      continue;
    }

    const key = word.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(word);
    if (normalized.length >= customProfanityWordLimit) {
      break;
    }
  }

  return normalized;
};

export const settingsService = new SettingsService();
