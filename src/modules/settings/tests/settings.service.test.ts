import { normalizeCustomProfanityWords } from '../settings.service';

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
