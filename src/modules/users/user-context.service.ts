import {
  Organization,
  OrganizationKind,
  OrganizationMembership,
  OrganizationStatus,
  Prisma,
  Subscription,
  SubscriptionStatus,
  BrandingMode,
  OrganizationStorageProvider,
  OrganizationStorageStatus,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { prisma } from '@/config';

const userContextInclude = {
  primaryOrganization: true,
  memberships: {
    include: {
      organization: true,
    },
  },
  subscriptions: true,
} satisfies Prisma.UserInclude;

export type UserContextRecord = Prisma.UserGetPayload<{
  include: typeof userContextInclude;
}>;

export interface SubscriptionSummary {
  id: string;
  planName: string;
  status: SubscriptionStatus;
  seatLimit: number;
  seatUsage: number;
  brandingMode: BrandingMode;
  startDate: Date;
  endDate: Date | null;
  organizationId: string | null;
  userId: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  kind: OrganizationKind;
  status: OrganizationStatus;
  parentOrganizationId: string | null;
  brandingMode: BrandingMode;
  brandName: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  studentLoginEnabled: boolean;
  parentLoginEnabled: boolean;
  sessionOnlyJoinEnabled: boolean;
  teacherOnlyMode: boolean;
  teacherUserLimit: number | null;
  studentUserLimit: number | null;
  parentUserLimit: number | null;
  supportEmail: string | null;
  supportPhone: string | null;
  storageProviders: OrganizationStorageProvider[];
  defaultStorageProvider: OrganizationStorageProvider | null;
  storageProvider: OrganizationStorageProvider | null;
  storageStatus: OrganizationStorageStatus;
  aiSettings: OrganizationAiSettings | null;
}

export interface OrganizationAiSettings {
  geminiApiKey: string;
  geminiApiKeys: string[];
  geminiTextModel: string;
  geminiImageModel: string;
  geminiTtsModel: string;
  deepgramApiKey: string;
}

export interface SafeUserContext {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  timezone: string;
  language: string;
  createdAt: Date;
  invitedAt: Date;
  lastLoginAt: Date | null;
  primaryOrganization: OrganizationSummary | null;
  organizations: OrganizationSummary[];
  subscription: SubscriptionSummary | null;
}

const asJsonObject = (
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const aiSettingString = (
  ai: Record<string, unknown>,
  root: Record<string, unknown>,
  canonicalKey: string,
  legacyKey?: string,
): string =>
  asString(
    ai[canonicalKey] ??
      (legacyKey ? ai[legacyKey] : undefined) ??
      root[canonicalKey] ??
      (legacyKey ? root[legacyKey] : undefined),
  );

const aiSettingStringArray = (
  ai: Record<string, unknown>,
  root: Record<string, unknown>,
  canonicalKey: string,
  fallbackValue: string,
): string[] => {
  const raw = ai[canonicalKey] ?? root[canonicalKey];
  if (Array.isArray(raw)) {
    const keys = raw
      .map((value) => asString(value).trim())
      .filter((value) => value.length > 0);
    return Array.from(new Set(keys));
  }
  return fallbackValue.trim().length > 0 ? [fallbackValue.trim()] : [];
};

const toOrganizationAiSettings = (
  settings: Prisma.JsonValue | null | undefined,
): OrganizationAiSettings | null => {
  const root = asJsonObject(settings);
  const ai = asJsonObject(root.ai as Prisma.JsonValue | null | undefined);
  const geminiApiKey = aiSettingString(ai, root, 'geminiApiKey');
  const summary = {
    geminiApiKey,
    geminiApiKeys: aiSettingStringArray(
      ai,
      root,
      'geminiApiKeys',
      geminiApiKey,
    ),
    geminiTextModel: aiSettingString(
      ai,
      root,
      'geminiTextModel',
      'textModel',
    ),
    geminiImageModel: aiSettingString(
      ai,
      root,
      'geminiImageModel',
      'imageModel',
    ),
    geminiTtsModel: aiSettingString(
      ai,
      root,
      'geminiTtsModel',
      'ttsModel',
    ),
    deepgramApiKey: aiSettingString(ai, root, 'deepgramApiKey'),
  };

  const hasSettings =
    summary.geminiApiKeys.length > 0 ||
    summary.geminiApiKey.trim().length > 0 ||
    summary.geminiTextModel.trim().length > 0 ||
    summary.geminiImageModel.trim().length > 0 ||
    summary.geminiTtsModel.trim().length > 0 ||
    summary.deepgramApiKey.trim().length > 0;

  return hasSettings
    ? summary
    : null;
};

const toOrganizationSummary = (organization: Organization): OrganizationSummary => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  logoUrl: organization.logoUrl ?? null,
  kind: organization.kind,
  status: organization.status,
  parentOrganizationId: organization.parentOrganizationId,
  brandingMode: organization.brandingMode,
  brandName: organization.brandName ?? null,
  brandPrimaryColor: organization.brandPrimaryColor ?? null,
  brandAccentColor: organization.brandAccentColor ?? null,
  studentLoginEnabled: organization.studentLoginEnabled,
  parentLoginEnabled: organization.parentLoginEnabled,
  sessionOnlyJoinEnabled: organization.sessionOnlyJoinEnabled,
  teacherOnlyMode: organization.teacherOnlyMode,
  teacherUserLimit: organization.teacherUserLimit ?? null,
  studentUserLimit: organization.studentUserLimit ?? null,
  parentUserLimit: organization.parentUserLimit ?? null,
  supportEmail: organization.supportEmail ?? null,
  supportPhone: organization.supportPhone ?? null,
  storageProviders:
    organization.kind === OrganizationKind.INTERNAL
      ? [
          OrganizationStorageProvider.GOOGLE_DRIVE,
          OrganizationStorageProvider.DROPBOX,
          OrganizationStorageProvider.ONEDRIVE,
        ]
      : organization.storageProviders ?? [],
  defaultStorageProvider: organization.storageProvider ?? null,
  storageProvider: organization.storageProvider ?? null,
  storageStatus: organization.storageStatus,
  // Organization-level AI keys are intentionally no longer exposed. The
  // whiteboard now uses the centralized backend AI module with one master key.
  aiSettings: null,
});

const toSubscriptionSummary = (
  subscription: Subscription | null | undefined,
): SubscriptionSummary | null => {
  if (!subscription) {
    return null;
  }

  return {
    id: subscription.id,
    planName: subscription.planName,
    status: subscription.status,
    brandingMode: subscription.brandingMode,
    seatLimit: subscription.seatLimit,
    seatUsage: subscription.seatUsage,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    organizationId: subscription.organizationId ?? null,
    userId: subscription.userId ?? null,
  };
};

const dedupeOrganizations = (
  memberships: Array<OrganizationMembership & { organization: Organization }>,
  primaryOrganization: Organization | null,
): OrganizationSummary[] => {
  const summaries = memberships
    .filter((membership) => !membership.organization.deletedAt)
    .map((membership) => toOrganizationSummary(membership.organization));
  if (primaryOrganization && !primaryOrganization.deletedAt) {
    summaries.push(toOrganizationSummary(primaryOrganization));
  }

  const byId = new Map<string, OrganizationSummary>();
  for (const summary of summaries) {
    byId.set(summary.id, summary);
  }
  return Array.from(byId.values());
};

export const toSafeUserContext = (
  user: UserContextRecord,
  organizationSubscription?: Subscription | null,
): SafeUserContext => {
  const primaryOrganization =
    user.primaryOrganization && !user.primaryOrganization.deletedAt
      ? user.primaryOrganization
      : null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    timezone: user.timezone,
    language: user.language,
    createdAt: user.createdAt,
    invitedAt: user.invitedAt,
    lastLoginAt: user.lastLoginAt ?? null,
    primaryOrganization: primaryOrganization
      ? toOrganizationSummary(primaryOrganization)
      : null,
    organizations: dedupeOrganizations(user.memberships, primaryOrganization),
    subscription: toSubscriptionSummary(user.subscriptions[0] ?? organizationSubscription),
  };
};

export const findUserContextById = async (
  userId: string,
): Promise<SafeUserContext | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userContextInclude,
  });

  if (!user || user.deletedAt) {
    return null;
  }

  const organizationId =
    (user.primaryOrganization && !user.primaryOrganization.deletedAt
      ? user.primaryOrganizationId
      : null) ??
    user.memberships.find((membership) => !membership.organization.deletedAt)
      ?.organizationId;
  const organizationSubscription = organizationId
    ? await prisma.subscription.findFirst({
        where: { organizationId },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      })
    : null;

  return toSafeUserContext(user, organizationSubscription);
};
