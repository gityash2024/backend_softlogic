import crypto from 'crypto';

import { prisma } from '@/config';

import {
  getSupportedLanguage,
  normalizeLanguageId,
  supportedPortalLanguages,
} from './language-registry';
import { GoogleTranslationProvider, TranslationProvider } from './i18n.provider';

export interface TranslationCacheEntry {
  sourceLanguage: string;
  targetLanguage: string;
  sourceHash: string;
  sourceText: string;
  translatedText: string;
  provider: string;
}

export interface TranslationCacheStore {
  findMany(input: {
    sourceLanguage: string;
    targetLanguage: string;
    sourceHashes: string[];
  }): Promise<TranslationCacheEntry[]>;
  upsertMany(entries: TranslationCacheEntry[]): Promise<void>;
}

export class PrismaTranslationCacheStore implements TranslationCacheStore {
  async findMany(input: {
    sourceLanguage: string;
    targetLanguage: string;
    sourceHashes: string[];
  }): Promise<TranslationCacheEntry[]> {
    if (input.sourceHashes.length === 0) {
      return [];
    }

    return prisma.translationCache.findMany({
      where: {
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        sourceHash: { in: input.sourceHashes },
      },
      select: {
        sourceLanguage: true,
        targetLanguage: true,
        sourceHash: true,
        sourceText: true,
        translatedText: true,
        provider: true,
      },
    });
  }

  async upsertMany(entries: TranslationCacheEntry[]): Promise<void> {
    await Promise.all(
      entries.map((entry) =>
        prisma.translationCache.upsert({
          where: {
            sourceLanguage_targetLanguage_sourceHash: {
              sourceLanguage: entry.sourceLanguage,
              targetLanguage: entry.targetLanguage,
              sourceHash: entry.sourceHash,
            },
          },
          update: {
            translatedText: entry.translatedText,
            provider: entry.provider,
          },
          create: entry,
        }),
      ),
    );
  }
}

export interface TranslatePortalTextsResult {
  sourceLanguage: string;
  targetLanguage: string;
  translations: Array<{
    sourceText: string;
    translatedText: string;
    cached: boolean;
    provider: string;
  }>;
  providerAvailable: boolean;
}

const hashText = (text: string): string =>
  crypto.createHash('sha256').update(text).digest('hex');

const normalizeText = (text: string): string => text.trim();

export class I18nService {
  constructor(
    private readonly provider: TranslationProvider = new GoogleTranslationProvider(),
    private readonly cacheStore: TranslationCacheStore = new PrismaTranslationCacheStore(),
  ) {}

  listLanguages() {
    return supportedPortalLanguages;
  }

  async translatePortalTexts(input: {
    sourceLanguage?: string;
    targetLanguage: string;
    texts: string[];
  }): Promise<TranslatePortalTextsResult> {
    const source = getSupportedLanguage(input.sourceLanguage || 'en-us');
    const target = getSupportedLanguage(input.targetLanguage);
    const normalizedSourceLanguage = normalizeLanguageId(source.id);
    const normalizedTargetLanguage = normalizeLanguageId(target.id);
    const texts = input.texts.map(normalizeText).filter(Boolean);

    if (texts.length === 0 || normalizedSourceLanguage === normalizedTargetLanguage) {
      return {
        sourceLanguage: normalizedSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        providerAvailable: true,
        translations: texts.map((text) => ({
          sourceText: text,
          translatedText: text,
          cached: true,
          provider: 'identity',
        })),
      };
    }

    const requested = texts.map((text) => ({
      text,
      hash: hashText(text),
    }));
    let cachedEntries: TranslationCacheEntry[] = [];
    try {
      cachedEntries = await this.cacheStore.findMany({
        sourceLanguage: normalizedSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        sourceHashes: requested.map((entry) => entry.hash),
      });
    } catch {
      cachedEntries = [];
    }
    const cachedByHash = new Map(cachedEntries.map((entry) => [entry.sourceHash, entry]));
    const cachedHashes = new Set(cachedEntries.map((entry) => entry.sourceHash));
    const missing = requested.filter((entry) => !cachedByHash.has(entry.hash));

    let providerAvailable = true;
    if (missing.length > 0) {
      try {
        const translated = await this.provider.translateBatch({
          sourceLanguage: source.googleCode,
          targetLanguage: target.googleCode,
          texts: missing.map((entry) => entry.text),
        });
        const cacheEntries = missing.map((entry, index) => ({
          sourceLanguage: normalizedSourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          sourceHash: entry.hash,
          sourceText: entry.text,
          translatedText: translated[index] || entry.text,
          provider: 'google',
        }));
        try {
          await this.cacheStore.upsertMany(cacheEntries);
        } catch {
          // Live translations should still be returned even if cache persistence
          // is temporarily unavailable.
        }
        cacheEntries.forEach((entry) => cachedByHash.set(entry.sourceHash, entry));
      } catch {
        providerAvailable = false;
        missing.forEach((entry) => {
          cachedByHash.set(entry.hash, {
            sourceLanguage: normalizedSourceLanguage,
            targetLanguage: normalizedTargetLanguage,
            sourceHash: entry.hash,
            sourceText: entry.text,
            translatedText: entry.text,
            provider: 'fallback',
          });
        });
      }
    }

    return {
      sourceLanguage: normalizedSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      providerAvailable,
      translations: requested.map((entry) => {
        const translated = cachedByHash.get(entry.hash);
        return {
          sourceText: entry.text,
          translatedText: translated?.translatedText ?? entry.text,
          cached: cachedHashes.has(entry.hash) || translated?.provider !== 'google',
          provider: translated?.provider ?? 'fallback',
        };
      }),
    };
  }
}

export const i18nService = new I18nService();
