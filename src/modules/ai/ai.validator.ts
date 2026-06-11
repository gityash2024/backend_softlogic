import { AiCreditScope } from '@prisma/client';
import { z } from 'zod';

export const aiConfigSchema = z.object({
  geminiApiKey: z.string().trim().optional().nullable(),
  geminiTextModel: z.string().trim().min(1).optional(),
  geminiImageModel: z.string().trim().min(1).optional(),
  geminiTtsModel: z.string().trim().min(1).optional(),
  googleSearchGroundingEnabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const aiTopUpSchema = z.object({
  accountId: z.string().trim().optional().nullable(),
  amountTokens: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional().nullable(),
  referenceNote: z.string().trim().max(500).optional().nullable(),
});

const aiPricingRowSchema = z.object({
  modelId: z.string().trim().min(1).max(150),
  provider: z.string().trim().min(1).max(50).optional(),
  billingType: z.enum(['token', 'image', 'audio', 'tool']).default('token'),
  inputUsdMicrosPerMillion: z.coerce.number().int().nonnegative().default(0),
  outputUsdMicrosPerMillion: z.coerce.number().int().nonnegative().default(0),
  imageUsdMicrosEach: z.coerce.number().int().nonnegative().default(0),
  searchUsdMicrosPerThousand: z.coerce.number().int().nonnegative().default(0),
  enabled: z.boolean().optional(),
});

export const aiPricingSchema = z.object({
  pricing: z.array(aiPricingRowSchema).min(1).max(25),
});

export const aiGoogleBillingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  projectId: z.string().trim().min(1).max(100).optional(),
  billingTableProjectId: z.string().trim().min(1).max(100).optional().nullable(),
  billingDatasetId: z.string().trim().min(1).max(150).optional().nullable(),
  billingTableName: z.string().trim().min(1).max(150).optional().nullable(),
  monthlyCapMicros: z.coerce.number().int().positive().optional(),
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

export const aiSetAllocationSchema = z.object({
  sourceAccountId: z.string().uuid().optional().nullable(),
  scope: z.nativeEnum(AiCreditScope),
  organizationId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  allocatedTokens: z.coerce.number().int().nonnegative(),
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

export const aiFeatureAttemptSchema = z.object({
  featureKey: z.literal('text_to_media').optional(),
  attemptId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});
