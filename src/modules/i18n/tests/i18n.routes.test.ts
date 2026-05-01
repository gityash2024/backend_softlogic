import request from 'supertest';
import { UserRole } from '@prisma/client';

import { createApp } from '@/app';
import { i18nService } from '@/modules/i18n/i18n.service';
import { generateAccessToken } from '@/shared/utils/jwt';

jest.mock('@/modules/i18n/i18n.service', () => ({
  i18nService: {
    listLanguages: jest.fn(),
    translatePortalTexts: jest.fn(),
  },
}));

const mockedI18nService = i18nService as jest.Mocked<typeof i18nService>;

const authToken = generateAccessToken({
  userId: 'teacher-1',
  email: 'teacher@example.com',
  role: UserRole.TEACHER,
  organizationId: 'org-1',
});

describe('I18n routes', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication for the language registry', async () => {
    const response = await request(app).get('/api/v1/i18n/languages');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(mockedI18nService.listLanguages).not.toHaveBeenCalled();
  });

  it('returns supported languages for authenticated users', async () => {
    mockedI18nService.listLanguages.mockReturnValue([
      {
        id: 'en-us',
        englishName: 'English (US)',
        nativeName: 'English (US)',
        googleCode: 'en',
        regionCode: 'US',
      },
      {
        id: 'ar-sa',
        englishName: 'Arabic',
        nativeName: 'العربية',
        googleCode: 'ar',
        regionCode: 'AR',
      },
    ]);

    const response = await request(app)
      .get('/api/v1/i18n/languages')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
  });

  it('validates translation request limits before calling the service', async () => {
    const response = await request(app)
      .post('/api/v1/i18n/translate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        targetLanguage: 'ar-sa',
        texts: Array.from({ length: 51 }, (_, index) => `Text ${index}`),
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(mockedI18nService.translatePortalTexts).not.toHaveBeenCalled();
  });

  it('translates authenticated batched portal strings', async () => {
    mockedI18nService.translatePortalTexts.mockResolvedValue({
      sourceLanguage: 'en-us',
      targetLanguage: 'ar-sa',
      providerAvailable: true,
      translations: [
        {
          sourceText: 'Save Changes',
          translatedText: 'حفظ التغييرات',
          cached: false,
          provider: 'google',
        },
      ],
    });

    const response = await request(app)
      .post('/api/v1/i18n/translate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sourceLanguage: 'en-us',
        targetLanguage: 'ar-sa',
        texts: ['Save Changes'],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.translations[0]).toMatchObject({
      sourceText: 'Save Changes',
      translatedText: 'حفظ التغييرات',
    });
    expect(mockedI18nService.translatePortalTexts).toHaveBeenCalledWith({
      sourceLanguage: 'en-us',
      targetLanguage: 'ar-sa',
      texts: ['Save Changes'],
    });
  });
});
