import { env } from '@/config';

import { protectPlaceholders } from './placeholder-utils';

export interface TranslationProvider {
  translateBatch(input: {
    sourceLanguage: string;
    targetLanguage: string;
    texts: string[];
  }): Promise<string[]>;
}

interface GoogleTranslateResponse {
  data?: {
    translations?: Array<{ translatedText?: string }>;
  };
  error?: { message?: string };
}

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

export class GoogleTranslationProvider implements TranslationProvider {
  async translateBatch(input: {
    sourceLanguage: string;
    targetLanguage: string;
    texts: string[];
  }): Promise<string[]> {
    const apiKey = env.GOOGLE_TRANSLATE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Google Translate API key is not configured.');
    }

    const protectedTexts = input.texts.map(protectPlaceholders);
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: protectedTexts.map((entry) => entry.text),
          source: input.sourceLanguage,
          target: input.targetLanguage,
          format: 'text',
        }),
      },
    );

    const payload = (await response.json()) as GoogleTranslateResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message || 'Google Translate request failed.');
    }

    const translated = payload.data?.translations ?? [];
    if (translated.length !== input.texts.length) {
      throw new Error('Google Translate returned an unexpected response.');
    }

    return translated.map((entry, index) => {
      const value = decodeHtmlEntities(entry.translatedText ?? input.texts[index]);
      return protectedTexts[index].restore(value);
    });
  }
}
