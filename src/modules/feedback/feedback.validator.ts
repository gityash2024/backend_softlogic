import { z } from 'zod';

const clientIdSchema = z.string().min(8).max(64);
const nameSchema = z.string().trim().min(1).max(80);
const emailSchema = z.string().trim().email().max(254);
const bodySchema = z.string().trim().min(1).max(4000);
const resourceTypeSchema = z.string().trim().min(1).max(64);
const resourceIdSchema = z.string().trim().min(1).max(256);

const anchorSchema = z
  .object({
    quote: z.string().min(1).max(2000),
    prefix: z.string().max(200).default(''),
    suffix: z.string().max(200).default(''),
  })
  .strict();

const booleanFromQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined) return undefined;
    return value === 'true' || value === '1';
  });

export const listThreadsQuerySchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: resourceIdSchema,
  includeResolved: booleanFromQuery,
});

export const createThreadSchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: resourceIdSchema,
  anchor: anchorSchema.optional().nullable(),
  body: bodySchema,
  authorClientId: clientIdSchema,
  authorName: nameSchema,
  authorEmail: emailSchema,
});

export const addCommentSchema = z.object({
  body: bodySchema,
  authorClientId: clientIdSchema,
  authorName: nameSchema,
  authorEmail: emailSchema,
});

export const updateThreadStatusSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']),
  authorClientId: clientIdSchema,
  authorName: nameSchema,
});

export const editCommentSchema = z.object({
  body: bodySchema,
  authorClientId: clientIdSchema,
});

export const deleteAuthSchema = z.object({
  authorClientId: clientIdSchema,
});

export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type UpdateThreadStatusInput = z.infer<typeof updateThreadStatusSchema>;
export type EditCommentInput = z.infer<typeof editCommentSchema>;
export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;
