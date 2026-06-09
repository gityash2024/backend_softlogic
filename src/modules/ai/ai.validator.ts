import { AiCreditScope } from '@prisma/client';
import { z } from 'zod';

export const aiConfigSchema = z.object({
  geminiApiKey: z.string().trim().optional().nullable(),
  geminiTextModel: z.string().trim().min(1).optional(),
  geminiImageModel: z.string().trim().min(1).optional(),
  geminiTtsModel: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const aiTopUpSchema = z.object({
  accountId: z.string().trim().optional().nullable(),
  amountTokens: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional().nullable(),
  referenceNote: z.string().trim().max(500).optional().nullable(),
});

export const aiAllocationSchema = z.object({
  sourceAccountId: z.string().uuid().optional().nullable(),
  scope: z.nativeEnum(AiCreditScope),
  organizationId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  amountTokens: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional().nullable(),
  referenceNote: z.string().trim().max(500).optional().nullable(),
});

export const geminiProxySchema = z.object({
  modelId: z.string().trim().min(1),
  data: z.record(z.unknown()),
  enableGoogleSearch: z.boolean().optional(),
  feature: z.string().trim().max(100).optional(),
  operation: z.enum(['generateContent', 'predict']).optional(),
});
