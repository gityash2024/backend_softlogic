import { PerformanceLevel } from '@prisma/client';

import { prisma } from '@/config';

const legacyPerformanceModeToLevel = (
  performanceMode: boolean | undefined,
): PerformanceLevel | undefined => {
  if (performanceMode === undefined) {
    return undefined;
  }

  return performanceMode ? PerformanceLevel.LOW : PerformanceLevel.HIGH;
};

export class SettingsService {
  async getByUser(userId: string) {
    return prisma.userSettings.findUnique({ where: { userId } });
  }
}

const customProfanityWordLimit = 100;

export const normalizePerformanceLevel = (
  performanceLevel: unknown,
  legacyPerformanceMode?: boolean,
): PerformanceLevel => {
  if (typeof performanceLevel === 'string') {
    const normalized = performanceLevel.trim().toUpperCase();
    if (
      normalized === PerformanceLevel.LOW ||
      normalized === PerformanceLevel.MEDIUM ||
      normalized === PerformanceLevel.HIGH
    ) {
      return normalized as PerformanceLevel;
    }
  }

  return legacyPerformanceModeToLevel(legacyPerformanceMode) ?? PerformanceLevel.HIGH;
};

export const toLegacyPerformanceMode = (
  performanceLevel: PerformanceLevel | null | undefined,
): boolean => normalizePerformanceLevel(performanceLevel) === PerformanceLevel.LOW;

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
