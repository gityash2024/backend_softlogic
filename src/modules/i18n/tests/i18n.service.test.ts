import { I18nService, TranslationCacheEntry, TranslationCacheStore } from '../i18n.service';
import {
  GoogleFreeTranslationProvider,
  TranslationProvider,
} from '../i18n.provider';
import type { VitaletsTranslateFn } from '../i18n.provider';
import {
  normalizeLanguageId,
  supportedPortalLanguages,
} from '../language-registry';
import { protectPlaceholders } from '../placeholder-utils';

class InMemoryCacheStore implements TranslationCacheStore {
  readonly entries = new Map<string, TranslationCacheEntry>();

  async findMany(input: {
    sourceLanguage: string;
    targetLanguage: string;
    sourceHashes: string[];
  }): Promise<TranslationCacheEntry[]> {
    return input.sourceHashes
      .map((hash) => this.entries.get(`${input.sourceLanguage}:${input.targetLanguage}:${hash}`))
      .filter((entry): entry is TranslationCacheEntry => Boolean(entry));
  }

  async upsertMany(entries: TranslationCacheEntry[]): Promise<void> {
    entries.forEach((entry) => {
      this.entries.set(
        `${entry.sourceLanguage}:${entry.targetLanguage}:${entry.sourceHash}`,
        entry,
      );
    });
  }
}

class FakeProvider implements TranslationProvider {
  readonly providerName = 'google-free';
  calls = 0;

  constructor(private readonly suffix = ' translated') {}

  async translateBatch(input: {
    sourceLanguage: string;
    targetLanguage: string;
    texts: string[];
  }): Promise<string[]> {
    this.calls += 1;
    return input.texts.map((text) => `${text}${this.suffix}`);
  }
}

class FailingProvider implements TranslationProvider {
  readonly providerName = 'google-free';

  async translateBatch(): Promise<string[]> {
    throw new Error('provider unavailable');
  }
}

describe('supportedPortalLanguages', () => {
  it('contains the full 75 selectable language registry', () => {
    expect(supportedPortalLanguages).toHaveLength(75);
  });

  it('normalizes language and locale aliases', () => {
    expect(normalizeLanguageId('es')).toBe('es-es');
    expect(normalizeLanguageId('PT_pt')).toBe('pt-pt');
    expect(normalizeLanguageId('az')).toBe('az-az');
    expect(normalizeLanguageId('zu-ZA')).toBe('zu-za');
    expect(normalizeLanguageId('unknown')).toBe('en-us');
  });
});

describe('protectPlaceholders', () => {
  it('restores named placeholders after translation', () => {
    const protectedText = protectPlaceholders('Unable to save: {error}');
    expect(protectedText.text).toBe('Unable to save: __SLP0__');
    expect(protectedText.restore('No se pudo guardar: __SLP0__')).toBe(
      'No se pudo guardar: {error}',
    );
  });
});

describe('I18nService', () => {
  it('returns provider translations and caches them', async () => {
    const provider = new FakeProvider();
    const cache = new InMemoryCacheStore();
    const service = new I18nService(provider, cache);

    const first = await service.translatePortalTexts({
      sourceLanguage: 'en-us',
      targetLanguage: 'es-es',
      texts: ['Save Changes'],
    });
    expect(first.providerAvailable).toBe(true);
    expect(first.translations[0]).toMatchObject({
      sourceText: 'Save Changes',
      translatedText: 'Save Changes translated',
      cached: false,
      provider: 'google-free',
    });

    const second = await service.translatePortalTexts({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      texts: ['Save Changes'],
    });
    expect(second.translations[0]).toMatchObject({
      translatedText: 'Save Changes translated',
      cached: true,
      provider: 'google-free',
    });
    expect(provider.calls).toBe(1);
  });

  it('falls back to source text when provider is unavailable', async () => {
    const service = new I18nService(new FailingProvider(), new InMemoryCacheStore());

    const result = await service.translatePortalTexts({
      targetLanguage: 'fr-fr',
      texts: ['Language settings updated.'],
    });

    expect(result.providerAvailable).toBe(false);
    expect(result.translations[0]).toMatchObject({
      translatedText: 'Language settings updated.',
      cached: true,
      provider: 'fallback',
    });
  });
});

describe('GoogleFreeTranslationProvider', () => {
  it('keeps batch order and restores protected placeholders', async () => {
    const calls: Array<{ text: string; from?: string; to?: string }> = [];
    const translator = (async (
      text: string,
      options?: { from?: string; to?: string },
    ) => {
      calls.push({ text, from: options?.from, to: options?.to });
      return { text: `TX ${text}` };
    }) as unknown as VitaletsTranslateFn;
    const provider = new GoogleFreeTranslationProvider(translator, {
      concurrency: 2,
      retryDelayMs: 1,
      timeoutMs: 1000,
    });

    const result = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      texts: ['Hello {name}', 'World'],
    });

    expect(result).toEqual(['TX Hello {name}', 'TX World']);
    expect(calls).toEqual([
      { text: 'Hello __SLP0__', from: 'en', to: 'ja' },
      { text: 'World', from: 'en', to: 'ja' },
    ]);
  });

  it('retries transient failures without dropping text', async () => {
    let attempts = 0;
    const translator = (async (text: string) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary failure');
      }
      return { text: `OK ${text}` };
    }) as unknown as VitaletsTranslateFn;
    const provider = new GoogleFreeTranslationProvider(translator, {
      concurrency: 1,
      retryCount: 1,
      retryDelayMs: 1,
      timeoutMs: 1000,
    });

    await expect(
      provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        texts: ['Retry me'],
      }),
    ).resolves.toEqual(['OK Retry me']);
    expect(attempts).toBe(2);
  });
});
