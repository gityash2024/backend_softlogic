import {
  AiCreditScope,
  BrandingMode,
  OrganizationKind,
  OrganizationStatus,
  OrganizationStorageProvider,
  OrganizationStorageStatus,
  PaymentProvider,
  PaymentProviderMode,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
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

// White-label brand colors accept #rgb or #rrggbb hex.
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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
  brandingMode: z.nativeEnum(BrandingMode).optional(),
  studentLoginEnabled: z.boolean().optional(),
  parentLoginEnabled: z.boolean().optional(),
  sessionOnlyJoinEnabled: z.boolean().optional(),
  teacherOnlyMode: z.boolean().optional(),
  supportEmail: z.string().email().optional().nullable(),
  supportPhone: z.string().min(3).max(40).optional().nullable(),
  storageProviders: z.array(z.nativeEnum(OrganizationStorageProvider)).optional(),
  defaultStorageProvider: z.nativeEnum(OrganizationStorageProvider).optional().nullable(),
  storageProvider: z.nativeEnum(OrganizationStorageProvider).optional().nullable(),
  storageStatus: z.nativeEnum(OrganizationStorageStatus).optional(),
  brandName: z.string().trim().min(1).max(120).optional().nullable(),
  brandPrimaryColor: z.string().trim().regex(HEX_COLOR_RE, 'Enter a valid hex color').optional().nullable(),
  brandAccentColor: z.string().trim().regex(HEX_COLOR_RE, 'Enter a valid hex color').optional().nullable(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: z.string().min(2).max(120).optional(),
  status: z.nativeEnum(OrganizationStatus).optional(),
  settings: z.record(z.unknown()).optional(),
  brandingMode: z.nativeEnum(BrandingMode).optional(),
  studentLoginEnabled: z.boolean().optional(),
  parentLoginEnabled: z.boolean().optional(),
  sessionOnlyJoinEnabled: z.boolean().optional(),
  teacherOnlyMode: z.boolean().optional(),
  supportEmail: z.string().email().optional().nullable(),
  supportPhone: z.string().min(3).max(40).optional().nullable(),
  storageProviders: z.array(z.nativeEnum(OrganizationStorageProvider)).optional(),
  defaultStorageProvider: z.nativeEnum(OrganizationStorageProvider).optional().nullable(),
  storageProvider: z.nativeEnum(OrganizationStorageProvider).optional().nullable(),
  storageStatus: z.nativeEnum(OrganizationStorageStatus).optional(),
  brandName: z.string().trim().min(1).max(120).optional().nullable(),
  brandPrimaryColor: z.string().trim().regex(HEX_COLOR_RE, 'Enter a valid hex color').optional().nullable(),
  brandAccentColor: z.string().trim().regex(HEX_COLOR_RE, 'Enter a valid hex color').optional().nullable(),
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
  linkedStudentIds: z.array(z.string().uuid()).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  organizationId: z.string().uuid().optional().nullable(),
  timezone: z.string().min(2).optional(),
  language: z.string().min(2).max(10).optional(),
  linkedStudentIds: z.array(z.string().uuid()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const bulkInviteSchema = z.object({
  users: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().min(2).max(120).optional().nullable(),
        role: z.nativeEnum(UserRole),
        organizationId: z.string().uuid().optional().nullable(),
      }),
    )
    .min(1, 'At least one user is required')
    .max(200, 'A maximum of 200 users can be invited at once'),
});

export const createSubscriptionSchema = z.object({
  organizationId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  planName: z.string().min(2).max(120),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  brandingMode: z.nativeEnum(BrandingMode).optional(),
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
  brandingMode: z.nativeEnum(BrandingMode).optional(),
  seatLimit: z.coerce.number().int().min(1).optional(),
  seatUsage: z.coerce.number().int().min(0).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

// #12 Renew subscription: set a new end date, optionally extend activation keys and record an offline payment.
export const renewSubscriptionSchema = z.object({
  newEndDate: z.coerce.date(),
  extendKeys: z.boolean().optional(),
  payment: z
    .object({
      amountMinor: z.coerce.number().int().positive(),
      currency: z.string().trim().min(3).max(3).optional().nullable(),
      referenceNote: z.string().trim().max(500).optional().nullable(),
    })
    .optional()
    .nullable(),
});

// Super Admin reject of a pending admin-created subscription (optional reason).
export const rejectSubscriptionSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

export const listUsersQuerySchema = listQueryBase.extend({
  role: z.string().trim().optional(),
  status: z.string().trim().optional(),
  organizationId: z.string().uuid().optional(),
  scope: z.enum(['ORGANIZATION', 'ALL']).optional(),
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

export const updatePaymentProviderSchema = z.object({
  provider: z.literal(PaymentProvider.MANUAL),
  enabled: z.boolean(),
  mode: z.nativeEnum(PaymentProviderMode).optional(),
});

export const recordOfflinePaymentSchema = z.object({
  organizationId: z.string().uuid().optional().nullable(),
  subscriptionId: z.string().uuid().optional().nullable(),
  amountMinor: z.coerce.number().int().positive(),
  currency: z.string().trim().min(3).max(3).optional(),
  referenceNote: z.string().trim().max(500).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const createHardwareActivationKeySchema = z.object({
  organizationId: z.string().uuid(),
  subscriptionId: z.string().uuid().optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
  // #3 Label is now required (non-empty, trimmed, max 120).
  label: z.string().trim().min(1).max(120),
  expiresAt: z.coerce.date().optional().nullable(),
  // #28 Optional device limit per key (>= 1, defaults to 1 = single-device behavior).
  maxDevices: z.coerce.number().int().min(1).default(1),
});

export const emailActivationKeysToOrgAdminSchema = z.object({
  organizationId: z.string().uuid(),
});

// Bulk-create hardware activation keys (1..100 rows). Each row mirrors the single-create body:
// label is required (trimmed, 1..120), maxDevices optional (>= 1), assignedUserId/expiresAt optional.
export const bulkCreateHardwareActivationKeysSchema = z.object({
  organizationId: z.string().uuid(),
  subscriptionId: z.string().uuid().optional().nullable(),
  keys: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        maxDevices: z.coerce.number().int().min(1).optional(),
        assignedUserId: z.string().uuid().optional().nullable(),
        expiresAt: z.coerce.date().optional().nullable(),
      }),
    )
    .min(1, 'At least one key is required')
    .max(100, 'A maximum of 100 keys can be created at once'),
});

// Activation-keys export: organization scope + the shared export format (xlsx|csv).
export const exportActivationKeysQuerySchema = exportQuerySchema.extend({
  organizationId: z.string().uuid(),
});

export const updateOrganizationSettingsSchema = z.object({
  settings: z.record(z.unknown()),
});

export const extendAiCreditsSchema = z.object({
  accountId: z.string().uuid().optional(),
  scope: z.nativeEnum(AiCreditScope).optional(),
  organizationId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  hardwareActivationKeyId: z.string().uuid().optional().nullable(),
  amountMinor: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional().nullable(),
  referenceNote: z.string().trim().max(500).optional().nullable(),
});

export const upsertOrganizationStorageSchema = z.object({
  provider: z.nativeEnum(OrganizationStorageProvider),
  status: z.nativeEnum(OrganizationStorageStatus).default(OrganizationStorageStatus.CONNECTED),
  externalAccountEmail: z.string().email().optional().nullable(),
  rootFolderId: z.string().trim().max(300).optional().nullable(),
  encryptedTokens: z.string().trim().optional().nullable(),
  lastError: z.string().trim().max(500).optional().nullable(),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type BulkInviteInput = z.infer<typeof bulkInviteSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
export type ListContentCanvasesQuery = z.infer<typeof listContentCanvasesQuerySchema>;
export type ListContentLiveSessionsQuery = z.infer<typeof listContentLiveSessionsQuerySchema>;
export type ListContentExportsQuery = z.infer<typeof listContentExportsQuerySchema>;
