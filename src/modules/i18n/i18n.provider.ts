import { translate } from '@vitalets/google-translate-api';

import { protectPlaceholders } from './placeholder-utils';

export interface TranslationProvider {
  readonly providerName: string;
  translateBatch(input: {
    sourceLanguage: string;
    targetLanguage: string;
    texts: string[];
  }): Promise<string[]>;
}

export type VitaletsTranslateFn = typeof translate;

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

export class GoogleFreeTranslationProvider implements TranslationProvider {
  readonly providerName = 'google-free';

  constructor(
    private readonly translateFn: VitaletsTranslateFn = translate,
    private readonly options: {
      concurrency?: number;
      retryCount?: number;
      retryDelayMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  async translateBatch(input: {
    sourceLanguage: string;
    targetLanguage: string;
    texts: string[];
  }): Promise<string[]> {
    if (input.texts.length === 0) {
      return [];
    }

    return mapWithConcurrency(
      input.texts,
      this.options.concurrency ?? 4,
      (text) => this.translateOne(text, input.sourceLanguage, input.targetLanguage),
    );
  }

  private async translateOne(
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string> {
    const retryCount = this.options.retryCount ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const protectedText = protectPlaceholders(sourceText);
        const translated = await this.translateProtectedText(
          protectedText.text,
          sourceLanguage,
          targetLanguage,
        );
        return protectedText.restore(decodeHtmlEntities(translated || sourceText));
      } catch (error) {
        lastError = error;
        if (attempt < retryCount) {
          await delay(this.options.retryDelayMs ?? 200);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Google free translation request failed.');
  }

  private async translateProtectedText(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 12000,
    );

    try {
      const result = await this.translateFn(text, {
        from: sourceLanguage,
        to: targetLanguage,
        fetchOptions: { signal: controller.signal as never },
      });
      return result.text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
