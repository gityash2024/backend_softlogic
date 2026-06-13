import {
  bulkCreateHardwareActivationKeysSchema,
  createOrganizationSchema,
  createHardwareActivationKeySchema,
  exportQuerySchema,
  listContentExportsQuerySchema,
  listUsersQuerySchema,
  updateOrganizationSchema,
} from '../admin.validator';
import { publishFullAppReleaseSchema } from '@/modules/app-updates/app-update.validator';

describe('admin organization validator', () => {
  it('allows organisation AI settings updates', () => {
    const result = updateOrganizationSchema.safeParse({
      settings: {
        ai: {
          geminiApiKey: 'test-key',
          geminiApiKeys: ['test-key', 'backup-key'],
          geminiTextModel: 'gemini-2.5-flash',
          geminiImageModel: 'gemini-2.5-flash-image',
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('still requires at least one update field', () => {
    const result = updateOrganizationSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('accepts organization role cap updates', () => {
    const result = updateOrganizationSchema.safeParse({
      parentLoginEnabled: true,
      teacherUserLimit: '3',
      studentUserLimit: 25,
      parentUserLimit: 25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        teacherUserLimit: 3,
        studentUserLimit: 25,
        parentUserLimit: 25,
      });
    }
  });

  it('normalizes blank optional organization fields to null', () => {
    const createResult = createOrganizationSchema.safeParse({
      name: 'Partner One',
      supportEmail: '',
      supportPhone: '',
      brandName: '',
      brandPrimaryColor: '',
      brandAccentColor: '',
    });
    const updateResult = updateOrganizationSchema.safeParse({
      supportEmail: '',
      supportPhone: '',
      brandName: '',
      brandPrimaryColor: '',
      brandAccentColor: '',
    });

    expect(createResult.success).toBe(true);
    expect(updateResult.success).toBe(true);
    if (createResult.success) {
      expect(createResult.data).toMatchObject({
        supportEmail: null,
        supportPhone: null,
        brandName: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
      });
    }
    if (updateResult.success) {
      expect(updateResult.data).toMatchObject({
        supportEmail: null,
        supportPhone: null,
        brandName: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
      });
    }
  });

  it('parses user list filters from query strings', () => {
    const result = listUsersQuerySchema.parse({
      search: 'teacher',
      role: 'TEACHER',
      status: 'ACTIVE',
      isEmailVerified: 'true',
      page: '2',
      perPage: '25',
      createdFrom: '2026-05-01',
      lastSeenTo: '2026-05-25',
    });

    expect(result).toMatchObject({
      search: 'teacher',
      role: 'TEACHER',
      status: 'ACTIVE',
      isEmailVerified: true,
      page: 2,
      perPage: 25,
    });
    expect(result.createdFrom).toBeInstanceOf(Date);
    expect(result.lastSeenTo).toBeInstanceOf(Date);
  });

  it('parses content export filters and export format', () => {
    const listResult = listContentExportsQuerySchema.parse({
      status: 'COMPLETED',
      format: 'PDF',
      completedFrom: '2026-05-01',
      completedTo: '2026-05-25',
      sortBy: 'completedAt',
      sortOrder: 'asc',
    });
    const exportResult = exportQuerySchema.parse({ format: 'csv' });

    expect(listResult.status).toBe('COMPLETED');
    expect(listResult.format).toBe('PDF');
    expect(listResult.sortOrder).toBe('asc');
    expect(exportResult.format).toBe('csv');
  });

  it('locks hardware activation key device count to one', () => {
    expect(
      createHardwareActivationKeySchema.safeParse({
        organizationId: '00000000-0000-0000-0000-000000000001',
        label: 'Lab board',
        maxDevices: 2,
      }).success,
    ).toBe(false);

    expect(
      bulkCreateHardwareActivationKeysSchema.safeParse({
        organizationId: '00000000-0000-0000-0000-000000000001',
        keys: [{ label: 'Lab board 1', maxDevices: 2 }],
      }).success,
    ).toBe(false);
  });

  it('requires all 8 app release links for a full release publish', () => {
    const completeArtifacts = (['staging', 'production'] as const).flatMap(
      (environment) =>
        (['softlogic', 'ai_smart_board'] as const).flatMap((brand) =>
          (['android', 'windows'] as const).map((platform) => ({
            environment,
            brand,
            platform,
            downloadUrl: `https://drive.google.com/file/d/${environment}-${brand}-${platform}/view?usp=sharing`,
          })),
        ),
    );

    expect(
      publishFullAppReleaseSchema.safeParse({
        versionName: '1.0.20',
        buildNumber: 21,
        releaseDate: '2026-06-13',
        notes: 'Release notes',
        artifacts: completeArtifacts,
      }).success,
    ).toBe(true);

    expect(
      publishFullAppReleaseSchema.safeParse({
        versionName: '1.0.20',
        buildNumber: 21,
        releaseDate: '2026-06-13',
        artifacts: completeArtifacts.slice(0, 7),
      }).success,
    ).toBe(false);
  });
});
