import { updateOrganizationSchema } from '../admin.validator';

describe('admin organization validator', () => {
  it('allows organisation AI settings updates', () => {
    const result = updateOrganizationSchema.safeParse({
      settings: {
        ai: {
          geminiApiKey: 'test-key',
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
});
