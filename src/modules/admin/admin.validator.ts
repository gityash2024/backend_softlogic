import { OrganizationKind, OrganizationStatus, SubscriptionStatus, UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';

const booleanQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.toLowerCase());
  return value;
}, z.boolean().optional());

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}, z.coerce.date().optional());

const listQueryBase = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const exportQuerySchema = z.object({
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120).optional(),
  kind: z.nativeEnum(OrganizationKind).optional(),
  status: z.nativeEnum(OrganizationStatus).optional(),
  parentOrganizationId: z.string().uuid().optional().nullable(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: z.string().min(2).max(120).optional(),
  status: z.nativeEnum(OrganizationStatus).optional(),
  settings: z.record(z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120).optional(),
  role: z.nativeEnum(UserRole),
  status: z.nativeEnum(UserStatus).optional(),
  organizationId: z.string().uuid().optional().nullable(),
  timezone: z.string().min(2).optional(),
  language: z.string().min(2).max(10).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  organizationId: z.string().uuid().optional().nullable(),
  timezone: z.string().min(2).optional(),
  language: z.string().min(2).max(10).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const createSubscriptionSchema = z.object({
  organizationId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  planName: z.string().min(2).max(120),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  seatLimit: z.coerce.number().int().min(1).default(1),
  seatUsage: z.coerce.number().int().min(0).default(0),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
}).refine((value) => Boolean(value.organizationId || value.userId), {
  message: 'organizationId or userId is required',
});

export const updateSubscriptionSchema = z.object({
  planName: z.string().min(2).max(120).optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  seatLimit: z.coerce.number().int().min(1).optional(),
  seatUsage: z.coerce.number().int().min(0).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const listUsersQuerySchema = listQueryBase.extend({
  role: z.string().trim().optional(),
  status: z.string().trim().optional(),
  organizationId: z.string().uuid().optional(),
  isEmailVerified: booleanQuery,
  createdFrom: optionalDate,
  createdTo: optionalDate,
  lastSeenFrom: optionalDate,
  lastSeenTo: optionalDate,
});

export const listOrganizationsQuerySchema = listQueryBase.extend({
  kind: z.string().trim().optional(),
  status: z.string().trim().optional(),
  parentOrganizationId: z.string().uuid().optional(),
  hasLogo: booleanQuery,
  aiConfigured: booleanQuery,
  createdFrom: optionalDate,
  createdTo: optionalDate,
  updatedFrom: optionalDate,
  updatedTo: optionalDate,
});

export const listSubscriptionsQuerySchema = listQueryBase.extend({
  status: z.string().trim().optional(),
  planName: z.string().trim().optional(),
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  expiringFrom: optionalDate,
  expiringTo: optionalDate,
  seatUsageMin: z.coerce.number().int().min(0).optional(),
  seatUsageMax: z.coerce.number().int().min(0).optional(),
  createdFrom: optionalDate,
  createdTo: optionalDate,
  startFrom: optionalDate,
  startTo: optionalDate,
  endFrom: optionalDate,
  endTo: optionalDate,
});

export const listActivityQuerySchema = listQueryBase.extend({
  actorUserId: z.string().uuid().optional(),
  action: z.string().trim().optional(),
  targetType: z.string().trim().optional(),
  targetId: z.string().trim().optional(),
  createdFrom: optionalDate,
  createdTo: optionalDate,
});

export const listContentCanvasesQuerySchema = listQueryBase.extend({
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  isPublic: booleanQuery,
  hasThumbnail: booleanQuery,
  createdFrom: optionalDate,
  createdTo: optionalDate,
  updatedFrom: optionalDate,
  updatedTo: optionalDate,
});

export const listContentLiveSessionsQuerySchema = listQueryBase.extend({
  status: z.string().trim().optional(),
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  canvasId: z.string().uuid().optional(),
  createdFrom: optionalDate,
  createdTo: optionalDate,
  startedFrom: optionalDate,
  startedTo: optionalDate,
  endedFrom: optionalDate,
  endedTo: optionalDate,
});

export const listContentExportsQuerySchema = listQueryBase.extend({
  status: z.string().trim().optional(),
  format: z.string().trim().optional(),
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  canvasId: z.string().uuid().optional(),
  createdFrom: optionalDate,
  createdTo: optionalDate,
  completedFrom: optionalDate,
  completedTo: optionalDate,
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
export type ListContentCanvasesQuery = z.infer<typeof listContentCanvasesQuerySchema>;
export type ListContentLiveSessionsQuery = z.infer<typeof listContentLiveSessionsQuerySchema>;
export type ListContentExportsQuery = z.infer<typeof listContentExportsQuerySchema>;
