import { z } from 'zod';

const driveUrlSchema = z
  .string()
  .trim()
  .url('Enter a valid Google Drive URL')
  .refine((value) => {
    try {
      return new URL(value).hostname === 'drive.google.com';
    } catch {
      return false;
    }
  }, 'Enter a Google Drive file URL');

export const releaseEnvironmentSchema = z.enum(['staging', 'production']);
export const releaseBrandSchema = z.enum(['softlogic', 'ai_smart_board']);
export const releasePlatformSchema = z.enum(['android', 'windows']);

export const checkAppUpdateQuerySchema = z.object({
  environment: releaseEnvironmentSchema,
  brand: releaseBrandSchema,
  platform: releasePlatformSchema,
  buildNumber: z.coerce.number().int().min(0),
});

export const listAppReleasesQuerySchema = z.object({
  environment: releaseEnvironmentSchema.optional(),
  brand: releaseBrandSchema.optional(),
  platform: releasePlatformSchema.optional(),
  currentOnly: z
    .preprocess((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.toLowerCase());
      return value;
    }, z.boolean().optional()),
});

const fullReleaseArtifactSchema = z.object({
  environment: releaseEnvironmentSchema,
  brand: releaseBrandSchema,
  platform: releasePlatformSchema,
  downloadUrl: driveUrlSchema,
});

export const publishFullAppReleaseSchema = z
  .object({
    versionName: z.string().trim().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 1.0.20'),
    buildNumber: z.coerce.number().int().positive(),
    releaseDate: z.coerce.date(),
    notes: z.string().trim().max(2000).optional().nullable(),
    artifacts: z.array(fullReleaseArtifactSchema).length(8, 'All 8 release links are required'),
  })
  .superRefine((value, ctx) => {
    const required = new Set<string>();
    for (const environment of releaseEnvironmentSchema.options) {
      for (const brand of releaseBrandSchema.options) {
        for (const platform of releasePlatformSchema.options) {
          required.add(`${environment}:${brand}:${platform}`);
        }
      }
    }

    const seen = new Set<string>();
    for (const artifact of value.artifacts) {
      const key = `${artifact.environment}:${artifact.brand}:${artifact.platform}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate artifact for ${key}`,
          path: ['artifacts'],
        });
      }
      seen.add(key);
      required.delete(key);
    }

    for (const key of required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing artifact for ${key}`,
        path: ['artifacts'],
      });
    }
  });

export const updateAppReleaseParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateAppReleaseSchema = z
  .object({
    versionName: z.string().trim().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 1.0.20').optional(),
    buildNumber: z.coerce.number().int().positive().optional(),
    releaseDate: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    downloadUrl: driveUrlSchema.optional(),
    isCurrent: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export type CheckAppUpdateQuery = z.infer<typeof checkAppUpdateQuerySchema>;
export type ListAppReleasesQuery = z.infer<typeof listAppReleasesQuerySchema>;
export type PublishFullAppReleaseInput = z.infer<typeof publishFullAppReleaseSchema>;
export type UpdateAppReleaseInput = z.infer<typeof updateAppReleaseSchema>;
