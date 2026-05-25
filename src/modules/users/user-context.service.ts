import {
  Organization,
  OrganizationKind,
  OrganizationMembership,
  OrganizationStatus,
  Prisma,
  Subscription,
  SubscriptionStatus,
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
  aiSettings: OrganizationAiSettings | null;
}

export interface OrganizationAiSettings {
  geminiApiKey: string;
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

const toOrganizationAiSettings = (
  settings: Prisma.JsonValue | null | undefined,
): OrganizationAiSettings | null => {
  const root = asJsonObject(settings);
  const ai = asJsonObject(root.ai as Prisma.JsonValue | null | undefined);
  const summary = {
    geminiApiKey: asString(ai.geminiApiKey ?? root.geminiApiKey),
    geminiTextModel: asString(ai.geminiTextModel ?? root.geminiTextModel),
    geminiImageModel: asString(ai.geminiImageModel ?? root.geminiImageModel),
    geminiTtsModel: asString(ai.geminiTtsModel ?? root.geminiTtsModel),
    deepgramApiKey: asString(ai.deepgramApiKey ?? root.deepgramApiKey),
  };

  return Object.values(summary).some((value) => value.trim().length > 0)
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
  aiSettings: toOrganizationAiSettings(organization.settings),
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
  const summaries = memberships.map((membership) =>
    toOrganizationSummary(membership.organization),
  );
  if (primaryOrganization) {
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
): SafeUserContext => ({
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
  primaryOrganization: user.primaryOrganization
    ? toOrganizationSummary(user.primaryOrganization)
    : null,
  organizations: dedupeOrganizations(user.memberships, user.primaryOrganization),
  subscription: toSubscriptionSummary(user.subscriptions[0] ?? organizationSubscription),
});

export const findUserContextById = async (
  userId: string,
): Promise<SafeUserContext | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userContextInclude,
  });

  if (!user) {
    return null;
  }

  const organizationId = user.primaryOrganizationId ?? user.memberships[0]?.organizationId;
  const organizationSubscription = organizationId
    ? await prisma.subscription.findFirst({
        where: { organizationId },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      })
    : null;

  return toSafeUserContext(user, organizationSubscription);
};
