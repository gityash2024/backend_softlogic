import {
  OrganizationKind,
  OrganizationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { toSafeUserContext, type UserContextRecord } from '../user-context.service';

const buildUserContextRecord = (
  settings: Record<string, unknown>,
): UserContextRecord =>
  ({
    id: 'user-1',
    email: 'teacher@softlogic.local',
    name: 'Teacher',
    avatar: null,
    role: UserRole.TEACHER,
    status: UserStatus.ACTIVE,
    isEmailVerified: true,
    timezone: 'UTC',
    language: 'en',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    invitedAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    primaryOrganizationId: 'org-1',
    primaryOrganization: {
      id: 'org-1',
      name: 'Softlogic Internal',
      slug: 'softlogic-internal',
      logoUrl: null,
      logoPublicId: null,
      kind: OrganizationKind.INTERNAL,
      status: OrganizationStatus.ACTIVE,
      parentOrganizationId: null,
      settings,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    memberships: [],
    subscriptions: [],
  }) as unknown as UserContextRecord;

describe('toSafeUserContext organization AI settings', () => {
  it('maps canonical Gemini model fields from organization settings', () => {
    const context = toSafeUserContext(
      buildUserContextRecord({
        ai: {
          geminiApiKey: 'gemini-key',
          geminiApiKeys: ['gemini-key', 'gemini-key-2'],
          geminiTextModel: 'gemini-2.5-flash',
          geminiImageModel: 'imagen-4.0-generate-001',
          geminiTtsModel: 'gemini-2.5-flash-preview-tts',
          deepgramApiKey: 'deepgram-key',
        },
      }),
    );

    expect(context.primaryOrganization?.aiSettings).toMatchObject({
      geminiApiKey: 'gemini-key',
      geminiApiKeys: ['gemini-key', 'gemini-key-2'],
      geminiTextModel: 'gemini-2.5-flash',
      geminiImageModel: 'imagen-4.0-generate-001',
      geminiTtsModel: 'gemini-2.5-flash-preview-tts',
      deepgramApiKey: 'deepgram-key',
    });
  });

  it('maps legacy textModel/imageModel/ttsModel fields for existing organizations', () => {
    const context = toSafeUserContext(
      buildUserContextRecord({
        ai: {
          geminiApiKey: 'legacy-key',
          textModel: 'gemini-2.0-flash',
          imageModel: 'gemini-2.5-flash-image',
          ttsModel: 'gemini-2.5-pro-preview-tts',
          deepgramApiKey: 'legacy-deepgram',
        },
      }),
    );

    expect(context.primaryOrganization?.aiSettings).toMatchObject({
      geminiApiKey: 'legacy-key',
      geminiApiKeys: ['legacy-key'],
      geminiTextModel: 'gemini-2.0-flash',
      geminiImageModel: 'gemini-2.5-flash-image',
      geminiTtsModel: 'gemini-2.5-pro-preview-tts',
      deepgramApiKey: 'legacy-deepgram',
    });
  });

  it('returns null when AI settings are empty', () => {
    const context = toSafeUserContext(buildUserContextRecord({ ai: {} }));

    expect(context.primaryOrganization?.aiSettings).toBeNull();
  });
});
