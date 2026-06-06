import {
  exportQuerySchema,
  listContentExportsQuerySchema,
  listUsersQuerySchema,
  updateOrganizationSchema,
} from '../admin.validator';

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
});
