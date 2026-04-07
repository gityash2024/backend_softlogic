import { PerformanceLevel } from '@prisma/client';

import {
  normalizeCustomProfanityWords,
  normalizePerformanceLevel,
  toLegacyPerformanceMode,
} from '../settings.service';

describe('normalizeCustomProfanityWords', () => {
  it('returns a trimmed de-duplicated list', () => {
    expect(
      normalizeCustomProfanityWords([
        '  Alpha  ',
        'alpha',
        '',
        ' Beta ',
        null,
        'Gamma',
      ]),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('falls back to an empty list for non-arrays', () => {
    expect(normalizeCustomProfanityWords('not-an-array')).toEqual([]);
    expect(normalizeCustomProfanityWords(null)).toEqual([]);
  });
});

describe('normalizePerformanceLevel', () => {
  it('prefers the new performance level when present', () => {
    expect(normalizePerformanceLevel('medium', false)).toBe(PerformanceLevel.MEDIUM);
  });

  it('maps legacy performance mode false to HIGH', () => {
    expect(normalizePerformanceLevel(undefined, false)).toBe(PerformanceLevel.HIGH);
  });

  it('maps legacy performance mode true to LOW', () => {
    expect(normalizePerformanceLevel(undefined, true)).toBe(PerformanceLevel.LOW);
  });

  it('defaults to HIGH when no setting exists', () => {
    expect(normalizePerformanceLevel(undefined, undefined)).toBe(PerformanceLevel.HIGH);
  });
});

describe('toLegacyPerformanceMode', () => {
  it('returns true only for LOW mode', () => {
    expect(toLegacyPerformanceMode(PerformanceLevel.LOW)).toBe(true);
    expect(toLegacyPerformanceMode(PerformanceLevel.MEDIUM)).toBe(false);
    expect(toLegacyPerformanceMode(PerformanceLevel.HIGH)).toBe(false);
  });
});
