import { SupportCategory, SupportPriority, SupportThreadStatus } from '@prisma/client';
import { z } from 'zod';

const listQueryBase = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
});

export const listThreadsQuerySchema = listQueryBase.extend({
  status: z.nativeEnum(SupportThreadStatus).optional(),
  category: z.nativeEnum(SupportCategory).optional(),
  priority: z.nativeEnum(SupportPriority).optional(),
  organizationId: z.string().uuid().optional(),
});

const seatsActionParamsSchema = z.object({
  to: z.coerce.number().int().min(1),
});
const subscriptionExtendParamsSchema = z.object({
  newEndDate: z.coerce.date(),
});
const resetDeviceParamsSchema = z.object({
  activationId: z.string().uuid(),
});
const orgStatusParamsSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
const extendKeyExpiryParamsSchema = z.object({
  activationKeyId: z.string().uuid(),
  newExpiresAt: z.coerce.date().nullable(),
});

export const requestedActionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('seats_increase'), params: seatsActionParamsSchema }),
    z.object({ kind: z.literal('seats_decrease'), params: seatsActionParamsSchema }),
    z.object({ kind: z.literal('subscription_extend'), params: subscriptionExtendParamsSchema }),
    z.object({ kind: z.literal('reset_device'), params: resetDeviceParamsSchema }),
    z.object({ kind: z.literal('disable_org'), params: orgStatusParamsSchema.partial() }),
    z.object({ kind: z.literal('enable_org'), params: orgStatusParamsSchema.partial() }),
    z.object({ kind: z.literal('extend_key_expiry'), params: extendKeyExpiryParamsSchema }),
  ])
  .optional()
  .nullable();

export const createThreadSchema = z.object({
  organizationId: z.string().uuid().optional(),
  category: z.nativeEnum(SupportCategory),
  subject: z.string().trim().min(2).max(180),
  body: z.string().trim().min(1).max(8000),
  priority: z.nativeEnum(SupportPriority).optional(),
  requestedAction: requestedActionSchema,
});

export const addMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});

export const updateStatusSchema = z.object({
  status: z.nativeEnum(SupportThreadStatus),
});

export const setPrioritySchema = z.object({
  priority: z.nativeEnum(SupportPriority),
});

export const applyActionSchema = z.object({
  kind: z.enum([
    'seats_increase',
    'seats_decrease',
    'subscription_extend',
    'reset_device',
    'disable_org',
    'enable_org',
    'extend_key_expiry',
  ]),
  params: z.record(z.unknown()).default({}),
  autoResolve: z.boolean().default(true),
});

export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;
export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type AddMessageInput = z.infer<typeof addMessageSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type SetPriorityInput = z.infer<typeof setPrioritySchema>;
export type ApplyActionInput = z.infer<typeof applyActionSchema>;
