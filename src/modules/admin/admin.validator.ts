import { OrganizationKind, OrganizationStatus, SubscriptionStatus, UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';

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
