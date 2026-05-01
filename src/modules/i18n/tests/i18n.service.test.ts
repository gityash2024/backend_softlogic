import { I18nService, TranslationCacheEntry, TranslationCacheStore } from '../i18n.service';
import { TranslationProvider } from '../i18n.provider';
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
  async translateBatch(): Promise<string[]> {
    throw new Error('provider unavailable');
  }
}

describe('supportedPortalLanguages', () => {
  it('contains more than 50 selectable languages', () => {
    expect(supportedPortalLanguages.length).toBeGreaterThanOrEqual(50);
  });

  it('normalizes language and locale aliases', () => {
    expect(normalizeLanguageId('es')).toBe('es-es');
    expect(normalizeLanguageId('PT_pt')).toBe('pt-pt');
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
      provider: 'google',
    });

    const second = await service.translatePortalTexts({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      texts: ['Save Changes'],
    });
    expect(second.translations[0]).toMatchObject({
      translatedText: 'Save Changes translated',
      cached: true,
      provider: 'google',
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
