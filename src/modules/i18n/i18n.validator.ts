import { z } from 'zod';

export const translatePortalTextsSchema = z.object({
  sourceLanguage: z.string().trim().min(2).max(20).optional(),
  targetLanguage: z.string().trim().min(2).max(20),
  texts: z
    .array(z.string().trim().min(1).max(800))
    .min(1)
    .max(50),
});
