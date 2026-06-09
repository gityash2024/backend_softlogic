import {
  BrandingMode,
  AiCreditAccountStatus,
  CheckoutSessionStatus,
  ContentImportStatus,
  ExportFormat,
  ExportStatus,
  HardwareActivationKeyStatus,
  HardwareActivationStatus,
  LiveSessionStatus,
  OrganizationKind,
  OrganizationStorageProvider,
  OrganizationStorageStatus,
  OtpType,
  PaymentProvider,
  PaymentProviderMode,
  OrganizationStatus,
  Prisma,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { env, prisma } from '@/config';
import {
  AuthenticatedUserLike,
  canManageRole,
  ensureOrganizationManaged,
  getManagedOrganizationIds,
} from '@/shared/utils/access-control';
import { AppError } from '@/shared/errors/AppError';
import { findUserContextById } from '@/modules/users/user-context.service';
import { licensingService } from '@/modules/licensing/licensing.service';
import { authRepository } from '@/modules/auth/auth.repository';
import { deleteImageAsset, uploadImageBuffer } from '@/shared/services/cloudinary.service';
import {
  sendPasswordSetupEmail,
  sendSessionsRevokedEmail,
  sendSubscriptionApprovedEmail,
  sendSubscriptionPendingEmail,
  sendSubscriptionRejectedEmail,
  sendWelcomeEmail,
} from '@/shared/utils/email';
import { generateAccessToken } from '@/shared/utils/jwt';
import { buildAdminExport, type AdminExportFormat } from './admin-export.util';
import type {
  BulkInviteInput,
  ListActivityQuery,
  ListContentCanvasesQuery,
  ListContentExportsQuery,
  ListContentImportsQuery,
  ListContentLiveSessionsQuery,
  ListOrganizationsQuery,
  ListSubscriptionsQuery,
  ListUsersQuery,
} from './admin.validator';

interface CreateOrganizationInput {
  name: string;
  slug?: string;
  kind?: OrganizationKind;
  parentOrganizationId?: string | null;
  brandingMode?: BrandingMode;
  studentLoginEnabled?: boolean;
  parentLoginEnabled?: boolean;
  sessionOnlyJoinEnabled?: boolean;
  teacherOnlyMode?: boolean;
  teacherUserLimit?: number | null;
  studentUserLimit?: number | null;
  parentUserLimit?: number | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  storageProviders?: OrganizationStorageProvider[];
  defaultStorageProvider?: OrganizationStorageProvider | null;
  storageProvider?: OrganizationStorageProvider | null;
  storageStatus?: OrganizationStorageStatus;
  brandName?: string | null;
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
}

interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  status?: OrganizationStatus;
  settings?: Record<string, unknown>;
  brandingMode?: BrandingMode;
  studentLoginEnabled?: boolean;
  parentLoginEnabled?: boolean;
  sessionOnlyJoinEnabled?: boolean;
  teacherOnlyMode?: boolean;
  teacherUserLimit?: number | null;
  studentUserLimit?: number | null;
  parentUserLimit?: number | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  storageProviders?: OrganizationStorageProvider[];
  defaultStorageProvider?: OrganizationStorageProvider | null;
  storageProvider?: OrganizationStorageProvider | null;
  storageStatus?: OrganizationStorageStatus;
  brandName?: string | null;
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
}

type PasswordSetupEmailPayload = {
  to: string;
  name: string | null;
  role: UserRole;
  organizationName?: string | null;
  setupUrl: string;
};

interface CreateUserInput {
  email: string;
  name?: string;
  role: UserRole;
  status?: UserStatus;
  organizationId?: string | null;
  timezone?: string;
  language?: string;
  linkedStudentIds?: string[];
}

interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  status?: UserStatus;
  organizationId?: string | null;
  timezone?: string;
  language?: string;
  linkedStudentIds?: string[];
}

interface DeleteUserResult {
  id: string;
  deletedAt: Date;
  archivedEmail: string;
  affectedOrganizationIds: string[];
  licenseSnapshots: Record<string, unknown>;
}

type OrganizationRolePolicy = {
  studentLoginEnabled: boolean;
  parentLoginEnabled: boolean;
  teacherOnlyMode: boolean;
  teacherUserLimit: number | null;
  studentUserLimit: number | null;
  parentUserLimit: number | null;
};

type OrganizationRolePolicyInput = Partial<OrganizationRolePolicy>;

interface DeleteOrganizationResult {
  id: string;
  deletedAt: Date;
  archivedSlug: string;
  archivedSupportEmail: string | null;
  affectedUserCount: number;
  canceledSubscriptionCount: number;
  canceledCheckoutSessionCount: number;
  disabledHardwareKeyCount: number;
  disabledHardwareActivationCount: number;
  disabledAiCreditAccountCount: number;
  disconnectedStorageConnectionCount: number;
}

interface CreateSubscriptionInput {
  organizationId?: string | null;
  userId?: string | null;
  planName: string;
  status?: SubscriptionStatus;
  brandingMode?: BrandingMode;
  seatLimit: number;
  seatUsage?: number;
  startDate: Date;
  endDate?: Date | null;
}

interface UpdateSubscriptionInput {
  planName?: string;
  status?: SubscriptionStatus;
  brandingMode?: BrandingMode;
  seatLimit?: number;
  seatUsage?: number;
  startDate?: Date;
  endDate?: Date | null;
}

interface UpdatePaymentProviderInput {
  provider: PaymentProvider;
  enabled: boolean;
  mode?: PaymentProviderMode;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  filters: Record<string, unknown>;
}

const ADMIN_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.CUSTOMER_ADMIN,
  UserRole.ADMIN,
] as const;

const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Super Admin',
  [UserRole.PARTNER_ADMIN]: 'Partner Admin',
  [UserRole.CUSTOMER_ADMIN]: 'Customer Admin',
  [UserRole.ADMIN]: 'Admin',
  [UserRole.TEACHER]: 'Teacher',
  [UserRole.PARENT]: 'Parent',
  [UserRole.STUDENT]: 'Student',
};

const USER_STATUS_LABEL: Record<UserStatus, string> = {
  [UserStatus.ACTIVE]: 'Active',
  [UserStatus.DISABLED]: 'Disabled',
};

const ORGANIZATION_KIND_LABEL: Record<OrganizationKind, string> = {
  [OrganizationKind.INTERNAL]: 'Internal',
  [OrganizationKind.PARTNER]: 'Partner',
  [OrganizationKind.CUSTOMER]: 'Customer',
};

const ORGANIZATION_STATUS_LABEL: Record<OrganizationStatus, string> = {
  [OrganizationStatus.ACTIVE]: 'Active',
  [OrganizationStatus.INACTIVE]: 'Inactive',
};

const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  [SubscriptionStatus.ACTIVE]: 'Active',
  [SubscriptionStatus.EXPIRED]: 'Expired',
  [SubscriptionStatus.CANCELED]: 'Canceled',
  [SubscriptionStatus.TRIAL]: 'Trial',
  [SubscriptionStatus.PENDING_APPROVAL]: 'Pending Approval',
};

const LIVE_SESSION_STATUS_LABEL: Record<LiveSessionStatus, string> = {
  [LiveSessionStatus.SCHEDULED]: 'Scheduled',
  [LiveSessionStatus.LIVE]: 'Live',
  [LiveSessionStatus.ENDED]: 'Ended',
  [LiveSessionStatus.CANCELLED]: 'Cancelled',
};

const EXPORT_STATUS_LABEL: Record<ExportStatus, string> = {
  [ExportStatus.PENDING]: 'Pending',
  [ExportStatus.PROCESSING]: 'Processing',
  [ExportStatus.COMPLETED]: 'Completed',
  [ExportStatus.FAILED]: 'Failed',
};

const CONTENT_IMPORT_STATUS_LABEL: Record<ContentImportStatus, string> = {
  [ContentImportStatus.PENDING]: 'Pending',
  [ContentImportStatus.PROCESSING]: 'Processing',
  [ContentImportStatus.CONVERTED]: 'Converted',
  [ContentImportStatus.FAILED]: 'Failed',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD_SETUP_EXPIRY_DAYS = 7;
const ADMIN_ONBOARDING_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.CUSTOMER_ADMIN,
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.STUDENT,
  UserRole.PARENT,
] as const;

const normalizeEmail = (value?: string | null): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const normalizeUserLimit = (value: number | null | undefined): number | null => {
  if (value === undefined || value === null) return null;
  return Math.max(0, Math.trunc(value));
};

const resolveOrganizationRolePolicy = (
  input: OrganizationRolePolicyInput,
  existing?: OrganizationRolePolicy,
): OrganizationRolePolicy => {
  const teacherOnlyMode = input.teacherOnlyMode ?? existing?.teacherOnlyMode ?? false;
  let parentLoginEnabled = input.parentLoginEnabled ?? existing?.parentLoginEnabled ?? false;
  let studentLoginEnabled = input.studentLoginEnabled ?? existing?.studentLoginEnabled ?? false;

  if (teacherOnlyMode) {
    parentLoginEnabled = false;
    studentLoginEnabled = false;
  } else if (parentLoginEnabled) {
    studentLoginEnabled = true;
  }

  return {
    teacherOnlyMode,
    parentLoginEnabled,
    studentLoginEnabled,
    teacherUserLimit: normalizeUserLimit(
      input.teacherUserLimit !== undefined
        ? input.teacherUserLimit
        : existing?.teacherUserLimit,
    ),
    studentUserLimit: teacherOnlyMode
      ? 0
      : normalizeUserLimit(
          input.studentUserLimit !== undefined
            ? input.studentUserLimit
            : existing?.studentUserLimit,
        ),
    parentUserLimit: teacherOnlyMode
      ? 0
      : parentLoginEnabled
        ? normalizeUserLimit(
            input.parentUserLimit !== undefined
              ? input.parentUserLimit
              : existing?.parentUserLimit,
          )
        : 0,
  };
};

const primaryAdminRoleForOrganization = (
  kind: OrganizationKind,
): UserRole => {
  if (kind === OrganizationKind.PARTNER) return UserRole.PARTNER_ADMIN;
  if (kind === OrganizationKind.INTERNAL) return UserRole.ADMIN;
  return UserRole.CUSTOMER_ADMIN;
};

const isAdminOnboardingRole = (role: UserRole): boolean =>
  ADMIN_ONBOARDING_ROLES.includes(role as (typeof ADMIN_ONBOARDING_ROLES)[number]);

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `org-${Date.now()}`;

const deletedEmailFor = (id: string): string =>
  `deleted-${id}@softlogic.local`;

const archivedSlugFor = (id: string, slug: string): string =>
  slugify(`archived-${id.slice(0, 8)}-${slug}`).slice(0, 120);

const asJsonObject = (
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const mergeOrganizationSettings = (
  existing: Prisma.JsonValue | null | undefined,
  incoming: Record<string, unknown>,
): Prisma.InputJsonObject =>
  ({
    ...asJsonObject(existing),
    ...incoming,
  }) as Prisma.InputJsonObject;

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

const formatUtcDay = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const buildCountBuckets = <T extends string>(
  values: readonly T[],
  keys: readonly T[],
  labels: Record<T, string>,
) => {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return keys.map((key) => ({
    key,
    label: labels[key],
    value: counts.get(key) ?? 0,
  }));
};

const buildDailyTrend = (dates: Date[], days = 14) => {
  const today = startOfUtcDay(new Date());
  const buckets = new Map<string, { date: string; label: string; value: number }>();

  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(today.getTime() - index * DAY_MS);
    const key = isoDay(day);
    buckets.set(key, {
      date: key,
      label: formatUtcDay(day),
      value: 0,
    });
  }

  dates.forEach((date) => {
    const key = isoDay(startOfUtcDay(date));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.value += 1;
    }
  });

  return Array.from(buckets.values());
};

const endOfUtcDay = (date: Date): Date => {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + DAY_MS - 1);
};

const csvEnumValues = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T[] | undefined => {
  if (!value) return undefined;
  const allowedSet = new Set<string>(allowed);
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is T => allowedSet.has(item));
  return values.length ? values : undefined;
};

const csvHasValue = (value: string | undefined, expected: string): boolean =>
  Boolean(
    value
      ?.split(',')
      .map((item) => item.trim().toUpperCase())
      .includes(expected),
  );

const dateRange = (
  from?: Date,
  to?: Date,
): Prisma.DateTimeFilter | undefined => {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: startOfUtcDay(from) } : {}),
    ...(to ? { lte: endOfUtcDay(to) } : {}),
  };
};

const paginationMeta = <T>(
  items: T[],
  total: number,
  page: number,
  perPage: number,
  filters: Record<string, unknown>,
): PaginatedResult<T> => {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return {
    items,
    total,
    page,
    perPage,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    filters,
  };
};

const nonEmptyFilters = (query: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );

export class AdminService {
  private readonly organizationInclude = {
    parentOrganization: true,
    primaryAdminUser: {
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isEmailVerified: true,
        lastLoginAt: true,
      },
    },
    storageConnections: {
      orderBy: { provider: 'asc' as const },
    },
    subscriptions: {
      orderBy: { updatedAt: 'desc' as const },
      take: 1,
    },
    _count: {
      select: {
        memberships: true,
        canvases: true,
        subscriptions: true,
      },
    },
  } satisfies Prisma.OrganizationInclude;

  private async assertOrganizationRoleLimitsCanApply(
    organizationId: string,
    policy: OrganizationRolePolicy,
  ): Promise<void> {
    const counts = await prisma.user.groupBy({
      by: ['role'],
      where: {
        primaryOrganizationId: organizationId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        role: { in: [UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT] },
      },
      _count: { _all: true },
    });
    const byRole = new Map(counts.map((row) => [row.role, row._count._all]));
    const checks: Array<{ role: UserRole; limit: number | null }> = [
      { role: UserRole.TEACHER, limit: policy.teacherUserLimit },
      { role: UserRole.STUDENT, limit: policy.studentUserLimit },
      { role: UserRole.PARENT, limit: policy.parentUserLimit },
    ];

    for (const check of checks) {
      const used = byRole.get(check.role) ?? 0;
      if (check.limit !== null && check.limit < used) {
        throw new AppError(
          `${ROLE_LABEL[check.role]} limit cannot be lower than current active users (${used})`,
          409,
        );
      }
    }
  }

  async getDashboardOverview(actor: AuthenticatedUserLike) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const trendStart = new Date(startOfUtcDay(new Date()).getTime() - 13 * DAY_MS);

    const userWhere = this.userScopeWhere(actor, managedOrganizationIds);
    const organizationWhere = this.organizationScopeWhere(managedOrganizationIds);
    const subscriptionWhere = this.subscriptionScopeWhere(actor, managedOrganizationIds);
    const canvasWhere = this.canvasScopeWhere(actor, managedOrganizationIds);
    const liveSessionWhere = this.liveSessionScopeWhere(actor, managedOrganizationIds);
    const exportWhere = this.exportScopeWhere(actor, managedOrganizationIds);
    const activityWhere = this.activityScopeWhere(actor, managedOrganizationIds);

    const [
      users,
      organizations,
      subscriptions,
      canvasCount,
      liveSessions,
      exports,
      recentActivity,
      activityTrendSource,
    ] = await Promise.all([
      prisma.user.findMany({
        where: userWhere,
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      prisma.organization.findMany({
        where: organizationWhere,
        select: {
          id: true,
          kind: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.subscription.findMany({
        where: subscriptionWhere,
        select: {
          id: true,
          status: true,
          seatLimit: true,
          seatUsage: true,
          createdAt: true,
          endDate: true,
        },
      }),
      prisma.canvas.count({ where: canvasWhere }),
      prisma.liveSession.findMany({
        where: liveSessionWhere,
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.export.findMany({
        where: exportWhere,
        select: {
          id: true,
          status: true,
          fileSize: true,
          createdAt: true,
        },
      }),
      prisma.adminAuditLog.findMany({
        where: activityWhere,
        include: {
          actorUser: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.adminAuditLog.findMany({
        where: {
          ...activityWhere,
          createdAt: { gte: trendStart },
        },
        select: { createdAt: true },
      }),
    ]);

    const totalSeats = subscriptions.reduce((sum, subscription) => sum + subscription.seatLimit, 0);
    const usedSeats = subscriptions.reduce((sum, subscription) => sum + subscription.seatUsage, 0);
    const storageBytes = exports.reduce((sum, exportRecord) => sum + (exportRecord.fileSize ?? 0), 0);
    const activeSubscriptions = subscriptions.filter(
      (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
    );
    const expiringSoon = activeSubscriptions.filter((subscription) => {
      if (!subscription.endDate) return false;
      const remainingMs = subscription.endDate.getTime() - Date.now();
      return remainingMs >= 0 && remainingMs <= 30 * DAY_MS;
    }).length;

    return {
      generatedAt: new Date().toISOString(),
      scope: {
        type: managedOrganizationIds === null ? 'GLOBAL' : 'MANAGED',
        organizationIds: managedOrganizationIds,
      },
      users: {
        total: users.length,
        active: users.filter((user) => user.status === UserStatus.ACTIVE).length,
        disabled: users.filter((user) => user.status === UserStatus.DISABLED).length,
        admins: users.filter((user) =>
          ADMIN_ROLES.includes(user.role as (typeof ADMIN_ROLES)[number]),
        ).length,
        newThisPeriod: users.filter((user) => user.createdAt >= trendStart).length,
        byRole: buildCountBuckets(
          users.map((user) => user.role),
          [
            UserRole.SUPER_ADMIN,
            UserRole.ADMIN,
            UserRole.PARTNER_ADMIN,
            UserRole.CUSTOMER_ADMIN,
            UserRole.TEACHER,
            UserRole.STUDENT,
          ],
          ROLE_LABEL,
        ),
        byStatus: buildCountBuckets(
          users.map((user) => user.status),
          [UserStatus.ACTIVE, UserStatus.DISABLED],
          USER_STATUS_LABEL,
        ),
      },
      organizations: {
        total: organizations.length,
        active: organizations.filter(
          (organization) => organization.status === OrganizationStatus.ACTIVE,
        ).length,
        inactive: organizations.filter(
          (organization) => organization.status === OrganizationStatus.INACTIVE,
        ).length,
        newThisPeriod: organizations.filter((organization) => organization.createdAt >= trendStart)
          .length,
        byKind: buildCountBuckets(
          organizations.map((organization) => organization.kind),
          [OrganizationKind.INTERNAL, OrganizationKind.PARTNER, OrganizationKind.CUSTOMER],
          ORGANIZATION_KIND_LABEL,
        ),
        byStatus: buildCountBuckets(
          organizations.map((organization) => organization.status),
          [OrganizationStatus.ACTIVE, OrganizationStatus.INACTIVE],
          ORGANIZATION_STATUS_LABEL,
        ),
      },
      subscriptions: {
        total: subscriptions.length,
        active: activeSubscriptions.length,
        expiringSoon,
        seatLimit: totalSeats,
        seatUsage: usedSeats,
        utilizationRate: totalSeats > 0 ? Math.round((usedSeats / totalSeats) * 100) : 0,
        byStatus: buildCountBuckets(
          subscriptions.map((subscription) => subscription.status),
          [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.PENDING_APPROVAL,
            SubscriptionStatus.EXPIRED,
            SubscriptionStatus.CANCELED,
          ],
          SUBSCRIPTION_STATUS_LABEL,
        ),
      },
      content: {
        canvases: {
          total: canvasCount,
        },
        liveSessions: {
          total: liveSessions.length,
          byStatus: buildCountBuckets(
            liveSessions.map((session) => session.status),
            [
              LiveSessionStatus.SCHEDULED,
              LiveSessionStatus.LIVE,
              LiveSessionStatus.ENDED,
              LiveSessionStatus.CANCELLED,
            ],
            LIVE_SESSION_STATUS_LABEL,
          ),
        },
        exports: {
          total: exports.length,
          storageBytes,
          byStatus: buildCountBuckets(
            exports.map((exportRecord) => exportRecord.status),
            [
              ExportStatus.PENDING,
              ExportStatus.PROCESSING,
              ExportStatus.COMPLETED,
              ExportStatus.FAILED,
            ],
            EXPORT_STATUS_LABEL,
          ),
        },
      },
      activity: {
        recent: recentActivity,
        trend: buildDailyTrend(
          activityTrendSource.map((entry) => entry.createdAt),
          14,
        ),
      },
    };
  }

  async listOrganizations(
    actor: AuthenticatedUserLike,
    query: ListOrganizationsQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const archivedOnly = csvHasValue(query.status, 'ARCHIVED');
    const and: Prisma.OrganizationWhereInput[] = [
      this.organizationScopeWhere(managedOrganizationIds, {
        includeArchived: archivedOnly,
      }),
      archivedOnly ? { deletedAt: { not: null } } : { deletedAt: null },
    ];
    const kinds = csvEnumValues(query.kind, [
      OrganizationKind.INTERNAL,
      OrganizationKind.PARTNER,
      OrganizationKind.CUSTOMER,
    ]);
    const statuses = csvEnumValues(query.status, [
      OrganizationStatus.ACTIVE,
      OrganizationStatus.INACTIVE,
    ]);
    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { slug: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (kinds) and.push({ kind: { in: kinds } });
    if (statuses) and.push({ status: { in: statuses } });
    if (query.parentOrganizationId) {
      and.push({ parentOrganizationId: query.parentOrganizationId });
    }
    if (query.hasLogo !== undefined) {
      and.push({ logoUrl: query.hasLogo ? { not: null } : null });
    }
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const updatedAt = dateRange(query.updatedFrom, query.updatedTo);
    if (updatedAt) and.push({ updatedAt });

    const where: Prisma.OrganizationWhereInput =
      and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.OrganizationOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['name', 'createdAt', 'updatedAt', 'kind', 'status'],
      'name',
      'asc',
    );
    const page = query.page;
    const perPage = query.perPage;
    const requiresInMemoryAiFilter = query.aiConfigured !== undefined;
    const skip =
      options.exportAll || requiresInMemoryAiFilter ? undefined : (page - 1) * perPage;
    const take = options.exportAll || requiresInMemoryAiFilter ? undefined : perPage;

    let [items, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        orderBy,
        skip,
        take,
        include: this.organizationInclude,
      }),
      prisma.organization.count({ where }),
    ]);

    if (query.aiConfigured !== undefined) {
      const hasAi = (organization: (typeof items)[number]) => {
        const ai = asJsonObject(organization.settings).ai;
        return Boolean(ai && typeof ai === 'object' && Object.keys(ai as object).length);
      };
      items = items.filter((organization) => hasAi(organization) === query.aiConfigured);
      total = items.length;
      if (!options.exportAll) {
        items = items.slice((page - 1) * perPage, page * perPage);
      }
    }

    return paginationMeta(
      items,
      total,
      page,
      options.exportAll ? total || perPage : perPage,
      nonEmptyFilters(query),
    );
  }

  async getOrganization(actor: AuthenticatedUserLike, organizationId: string) {
    await ensureOrganizationManaged(organizationId, actor);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: this.organizationInclude,
    });
    if (!organization || organization.deletedAt) throw new AppError('Organization not found', 404);
    return organization;
  }

  async exportOrganizations(actor: AuthenticatedUserLike, query: ListOrganizationsQuery & { format: AdminExportFormat }) {
    const result = await this.listOrganizations(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Organizations',
      fileBaseName: 'softlogic-organizations',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Name', key: 'name', width: 28, value: (row) => row.name },
        { header: 'Slug', key: 'slug', width: 24, value: (row) => row.slug },
        { header: 'Kind', key: 'kind', width: 16, value: (row) => ORGANIZATION_KIND_LABEL[row.kind] },
        {
          header: 'Status',
          key: 'status',
          width: 16,
          value: (row) => (row.deletedAt ? 'Archived' : ORGANIZATION_STATUS_LABEL[row.status]),
        },
        { header: 'Parent', key: 'parent', width: 28, value: (row) => row.parentOrganization?.name ?? '' },
        { header: 'Members', key: 'members', width: 12, value: (row) => row._count.memberships },
        { header: 'Canvases', key: 'canvases', width: 12, value: (row) => row._count.canvases },
        { header: 'Subscriptions', key: 'subscriptions', width: 16, value: (row) => row._count.subscriptions },
        { header: 'Logo URL', key: 'logoUrl', width: 40, value: (row) => row.logoUrl ?? '' },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
        { header: 'Updated At', key: 'updatedAt', width: 22, value: (row) => row.updatedAt },
      ],
    });
  }

  async createOrganization(
    actor: AuthenticatedUserLike,
    input: CreateOrganizationInput,
  ) {
    let kind = input.kind ?? OrganizationKind.CUSTOMER;
    let parentOrganizationId = input.parentOrganizationId ?? null;

    if (actor.role === 'PARTNER_ADMIN') {
      kind = OrganizationKind.CUSTOMER;
      parentOrganizationId = actor.organizationId ?? null;
      if (!parentOrganizationId) {
        throw new AppError('Partner admin is missing a primary organization', 400);
      }
    }

    if (parentOrganizationId) {
      await ensureOrganizationManaged(parentOrganizationId, actor);
    }

    const supportEmail = normalizeEmail(input.supportEmail);
    if (supportEmail) {
      await this.ensureSupportEmailAvailable(supportEmail);
    }
    const storage = this.resolveStorageSelection(input);
    const rolePolicy = resolveOrganizationRolePolicy(
      actor.role === UserRole.SUPER_ADMIN
        ? {
            studentLoginEnabled: input.studentLoginEnabled ?? false,
            parentLoginEnabled: input.parentLoginEnabled ?? false,
            teacherOnlyMode: input.teacherOnlyMode ?? false,
            teacherUserLimit: input.teacherUserLimit ?? null,
            studentUserLimit: input.studentUserLimit ?? null,
            parentUserLimit: input.parentUserLimit ?? null,
          }
        : {},
    );

    const setupEmails: PasswordSetupEmailPayload[] = [];

    const organization = await prisma.$transaction(async (tx) => {
      const createdOrganization = await tx.organization.create({
        data: {
          name: input.name,
          slug: input.slug ? slugify(input.slug) : slugify(input.name),
          kind,
          parentOrganizationId,
          brandingMode: actor.role === UserRole.SUPER_ADMIN
            ? input.brandingMode ?? BrandingMode.SOFTLOGIC
            : BrandingMode.SOFTLOGIC,
          // Brand identity is a Super-Admin-only commercial control. createOrganization
          // has no commercialKeys guard, so gate these inline just like brandingMode.
          brandName: actor.role === UserRole.SUPER_ADMIN ? input.brandName ?? null : null,
          brandPrimaryColor:
            actor.role === UserRole.SUPER_ADMIN ? input.brandPrimaryColor ?? null : null,
          brandAccentColor:
            actor.role === UserRole.SUPER_ADMIN ? input.brandAccentColor ?? null : null,
          studentLoginEnabled:
            actor.role === UserRole.SUPER_ADMIN ? rolePolicy.studentLoginEnabled : false,
          parentLoginEnabled:
            actor.role === UserRole.SUPER_ADMIN ? rolePolicy.parentLoginEnabled : false,
          sessionOnlyJoinEnabled:
            actor.role === UserRole.SUPER_ADMIN ? input.sessionOnlyJoinEnabled ?? true : true,
          teacherOnlyMode:
            actor.role === UserRole.SUPER_ADMIN ? rolePolicy.teacherOnlyMode : false,
          teacherUserLimit:
            actor.role === UserRole.SUPER_ADMIN ? rolePolicy.teacherUserLimit : null,
          studentUserLimit:
            actor.role === UserRole.SUPER_ADMIN ? rolePolicy.studentUserLimit : null,
          parentUserLimit:
            actor.role === UserRole.SUPER_ADMIN ? rolePolicy.parentUserLimit : null,
          supportEmail,
          supportPhone: input.supportPhone,
          storageProviders: storage.providers,
          storageProvider: storage.defaultProvider,
          storageStatus: storage.status,
          storageConnections:
            storage.providers.length > 0
              ? {
                  create: storage.providers.map((provider) => ({
                    provider,
                    status:
                      provider === storage.defaultProvider
                        ? storage.status
                        : OrganizationStorageStatus.NOT_CONFIGURED,
                  })),
                }
              : undefined,
        },
      });

      if (supportEmail) {
        const primaryAdminRole = primaryAdminRoleForOrganization(kind);
        const primaryAdminName = `${input.name} Admin`;
        const primaryAdmin = await tx.user.create({
          data: {
            email: supportEmail,
            name: primaryAdminName,
            role: primaryAdminRole,
            status: UserStatus.ACTIVE,
            timezone: 'UTC',
            language: 'en',
            invitedById: actor.userId,
            primaryOrganizationId: createdOrganization.id,
          },
        });

        await tx.organizationMembership.create({
          data: {
            userId: primaryAdmin.id,
            organizationId: createdOrganization.id,
          },
        });

        await tx.organization.update({
          where: { id: createdOrganization.id },
          data: { primaryAdminUserId: primaryAdmin.id },
        });

        const setupToken = await this.createPasswordSetupToken(tx, primaryAdmin.id);
        setupEmails.push({
          to: primaryAdmin.email,
          name: primaryAdmin.name ?? primaryAdminName,
          role: primaryAdmin.role,
          organizationName: createdOrganization.name,
          setupUrl: this.passwordSetupUrl(setupToken),
        });
      }

      const loaded = await tx.organization.findUnique({
        where: { id: createdOrganization.id },
        include: this.organizationInclude,
      });
      if (!loaded) {
        throw new AppError('Organization not found after create', 500);
      }
      return loaded;
    });

    const setupEmail = setupEmails[0];
    const setupEmailSent = setupEmail
      ? await sendPasswordSetupEmail({
          to: setupEmail.to,
          name: setupEmail.name,
          role: setupEmail.role,
          organizationName: setupEmail.organizationName,
          setupUrl: setupEmail.setupUrl,
          expiresInLabel: `${PASSWORD_SETUP_EXPIRY_DAYS} days`,
        })
      : null;

    await this.logAudit(actor.userId, 'organization.create', 'organization', organization.id, `Created organization ${organization.name}`);
    if (setupEmail && !setupEmailSent) {
      await this.logAudit(
        actor.userId,
        'organization.primary_admin.setup_email_failed',
        'organization',
        organization.id,
        `Password setup email failed for ${setupEmail.to}`,
      );
    }
    return { ...organization, setupEmailSent };
  }

  async updateOrganization(
    actor: AuthenticatedUserLike,
    organizationId: string,
    input: UpdateOrganizationInput,
  ) {
    await ensureOrganizationManaged(organizationId, actor);

    const existing = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        kind: true,
        deletedAt: true,
        settings: true,
        supportEmail: true,
        primaryAdminUserId: true,
        storageProvider: true,
        storageProviders: true,
        studentLoginEnabled: true,
        parentLoginEnabled: true,
        teacherOnlyMode: true,
        teacherUserLimit: true,
        studentUserLimit: true,
        parentUserLimit: true,
      },
    });
    if (!existing || existing.deletedAt) {
      throw new AppError('Organization not found', 404);
    }

    const commercialKeys: Array<keyof UpdateOrganizationInput> = [
      'brandingMode',
      'brandName',
      'brandPrimaryColor',
      'brandAccentColor',
      'studentLoginEnabled',
      'parentLoginEnabled',
      'sessionOnlyJoinEnabled',
      'teacherOnlyMode',
      'teacherUserLimit',
      'studentUserLimit',
      'parentUserLimit',
    ];
    if (
      actor.role !== UserRole.SUPER_ADMIN &&
      commercialKeys.some((key) => input[key] !== undefined)
    ) {
      throw new AppError('Only SoftLogic Super Admin can change organization commercial controls', 403);
    }

    const nextSupportEmail =
      input.supportEmail === undefined
        ? undefined
        : normalizeEmail(input.supportEmail);
    const supportEmailChanged =
      nextSupportEmail !== undefined &&
      nextSupportEmail !== normalizeEmail(existing.supportEmail);
    if (supportEmailChanged && nextSupportEmail) {
      await this.ensureSupportEmailAvailable(nextSupportEmail, {
        organizationId,
        allowedUserId: existing.primaryAdminUserId ?? undefined,
      });
    }

    const storage =
      input.storageProviders !== undefined ||
      input.defaultStorageProvider !== undefined ||
      input.storageProvider !== undefined ||
      input.storageStatus !== undefined
        ? this.resolveStorageSelection({
            storageProviders:
              input.storageProviders ?? existing.storageProviders,
            defaultStorageProvider:
              input.defaultStorageProvider ??
              input.storageProvider ??
              existing.storageProvider,
            storageProvider:
              input.storageProvider ??
              input.defaultStorageProvider ??
              existing.storageProvider,
            storageStatus: input.storageStatus,
          })
        : null;
    const rolePolicy = resolveOrganizationRolePolicy(input, {
      studentLoginEnabled: existing.studentLoginEnabled,
      parentLoginEnabled: existing.parentLoginEnabled,
      teacherOnlyMode: existing.teacherOnlyMode,
      teacherUserLimit: existing.teacherUserLimit,
      studentUserLimit: existing.studentUserLimit,
      parentUserLimit: existing.parentUserLimit,
    });
    if (commercialKeys.some((key) => input[key] !== undefined)) {
      await this.assertOrganizationRoleLimitsCanApply(organizationId, rolePolicy);
    }

    const data: Prisma.OrganizationUpdateInput = {
      name: input.name,
      slug: input.slug ? slugify(input.slug) : undefined,
      status: input.status,
      brandingMode: input.brandingMode,
      brandName: input.brandName,
      brandPrimaryColor: input.brandPrimaryColor,
      brandAccentColor: input.brandAccentColor,
      studentLoginEnabled:
        input.studentLoginEnabled !== undefined ||
        input.parentLoginEnabled !== undefined ||
        input.teacherOnlyMode !== undefined
          ? rolePolicy.studentLoginEnabled
          : undefined,
      parentLoginEnabled:
        input.parentLoginEnabled !== undefined ||
        input.teacherOnlyMode !== undefined
          ? rolePolicy.parentLoginEnabled
          : undefined,
      sessionOnlyJoinEnabled: input.sessionOnlyJoinEnabled,
      teacherOnlyMode:
        input.teacherOnlyMode !== undefined ? rolePolicy.teacherOnlyMode : undefined,
      teacherUserLimit:
        input.teacherUserLimit !== undefined ? rolePolicy.teacherUserLimit : undefined,
      studentUserLimit:
        input.studentUserLimit !== undefined ||
        input.teacherOnlyMode !== undefined
          ? rolePolicy.studentUserLimit
          : undefined,
      parentUserLimit:
        input.parentUserLimit !== undefined ||
        input.parentLoginEnabled !== undefined ||
        input.teacherOnlyMode !== undefined
          ? rolePolicy.parentUserLimit
          : undefined,
      supportEmail: nextSupportEmail,
      supportPhone: input.supportPhone,
      storageProviders: storage?.providers,
      storageProvider: storage?.defaultProvider,
      storageStatus: storage?.status,
    };
    if (input.settings !== undefined) {
      data.settings = mergeOrganizationSettings(
        existing.settings,
        input.settings,
      );
    }

    const setupEmails: PasswordSetupEmailPayload[] = [];

    const organization = await prisma.$transaction(async (tx) => {
      let primaryAdminUserId = existing.primaryAdminUserId;
      if (supportEmailChanged && nextSupportEmail) {
        const primaryAdminRole = primaryAdminRoleForOrganization(existing.kind);
        const primaryAdminName = `${input.name ?? existing.name} Admin`;
        if (primaryAdminUserId) {
          const primaryAdmin = await tx.user.update({
            where: { id: primaryAdminUserId },
            data: {
              email: nextSupportEmail,
              name: primaryAdminName,
              role: primaryAdminRole,
              status: UserStatus.ACTIVE,
              isEmailVerified: false,
              passwordHash: null,
              primaryOrganizationId: organizationId,
            },
          });
          await tx.organizationMembership.upsert({
            where: {
              userId_organizationId: {
                userId: primaryAdmin.id,
                organizationId,
              },
            },
            update: {},
            create: {
              userId: primaryAdmin.id,
              organizationId,
            },
          });
          const setupToken = await this.createPasswordSetupToken(tx, primaryAdmin.id);
          setupEmails.push({
            to: primaryAdmin.email,
            name: primaryAdmin.name ?? primaryAdminName,
            role: primaryAdmin.role,
            organizationName: input.name ?? existing.name,
            setupUrl: this.passwordSetupUrl(setupToken),
          });
        } else {
          const primaryAdmin = await tx.user.create({
            data: {
              email: nextSupportEmail,
              name: primaryAdminName,
              role: primaryAdminRole,
              status: UserStatus.ACTIVE,
              timezone: 'UTC',
              language: 'en',
              invitedById: actor.userId,
              primaryOrganizationId: organizationId,
            },
          });
          primaryAdminUserId = primaryAdmin.id;
          await tx.organizationMembership.create({
            data: {
              userId: primaryAdmin.id,
              organizationId,
            },
          });
          const setupToken = await this.createPasswordSetupToken(tx, primaryAdmin.id);
          setupEmails.push({
            to: primaryAdmin.email,
            name: primaryAdmin.name ?? primaryAdminName,
            role: primaryAdmin.role,
            organizationName: input.name ?? existing.name,
            setupUrl: this.passwordSetupUrl(setupToken),
          });
        }
        data.primaryAdminUser = primaryAdminUserId
          ? { connect: { id: primaryAdminUserId } }
          : undefined;
      }

      const updated = await tx.organization.update({
        where: { id: organizationId },
        data,
        include: this.organizationInclude,
      });

      if (storage) {
        await this.syncOrganizationStorageConnections(tx, organizationId, storage);
      }

      const reloaded = await tx.organization.findUnique({
        where: { id: organizationId },
        include: this.organizationInclude,
      });
      return reloaded ?? updated;
    });

    const setupEmail = setupEmails[0];
    const setupEmailSent = setupEmail
      ? await sendPasswordSetupEmail({
          to: setupEmail.to,
          name: setupEmail.name,
          role: setupEmail.role,
          organizationName: setupEmail.organizationName,
          setupUrl: setupEmail.setupUrl,
          expiresInLabel: `${PASSWORD_SETUP_EXPIRY_DAYS} days`,
        })
      : null;

    await this.logAudit(
      actor.userId,
      'organization.update',
      'organization',
      organization.id,
      `Updated organization ${organization.name}`,
    );
    if (setupEmail && !setupEmailSent) {
      await this.logAudit(
        actor.userId,
        'organization.primary_admin.setup_email_failed',
        'organization',
        organization.id,
        `Password setup email failed for ${setupEmail.to}`,
      );
    }
    return { ...organization, setupEmailSent };
  }

  async deleteOrganization(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ): Promise<DeleteOrganizationResult> {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('Only SoftLogic Super Admin can delete organizations', 403);
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        memberships: { select: { userId: true } },
      },
    });
    if (!organization || organization.deletedAt) {
      throw new AppError('Organization not found', 404);
    }
    if (organization.kind === OrganizationKind.INTERNAL) {
      throw new AppError('Internal SoftLogic organizations cannot be deleted', 400);
    }

    const activeChildCount = await prisma.organization.count({
      where: {
        parentOrganizationId: organizationId,
        status: OrganizationStatus.ACTIVE,
        deletedAt: null,
      },
    });
    if (activeChildCount > 0) {
      throw new AppError('Archive active child organizations before deleting this organization', 409);
    }

    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { primaryOrganizationId: organizationId },
          { memberships: { some: { organizationId } } },
        ],
      },
      select: {
        id: true,
        email: true,
        archivedEmail: true,
      },
    });
    const userIds = users.map((user) => user.id);
    const deletedAt = new Date();
    const archivedSlug = organization.archivedSlug ?? organization.slug;
    const archivedSupportEmail =
      organization.archivedSupportEmail ?? organization.supportEmail ?? null;
    const replacementSlug = archivedSlugFor(organization.id, organization.slug);

    let canceledSubscriptionCount = 0;
    let canceledCheckoutSessionCount = 0;
    let disabledHardwareKeyCount = 0;
    let disabledHardwareActivationCount = 0;
    let disabledAiCreditAccountCount = 0;
    let disconnectedStorageConnectionCount = 0;

    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          slug: replacementSlug,
          archivedSlug,
          archivedSupportEmail,
          supportEmail: null,
          primaryAdminUserId: null,
          status: OrganizationStatus.INACTIVE,
          storageProviders: [],
          storageProvider: null,
          storageStatus: OrganizationStorageStatus.NOT_CONFIGURED,
          deletedAt,
        },
      });

      for (const user of users) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: deletedEmailFor(user.id),
            archivedEmail: user.archivedEmail ?? user.email,
            googleId: null,
            passwordHash: null,
            status: UserStatus.DISABLED,
            isEmailVerified: false,
            deletedAt,
          },
        });
      }

      if (userIds.length > 0) {
        await tx.session.deleteMany({ where: { userId: { in: userIds } } });
        await tx.otp.deleteMany({ where: { userId: { in: userIds } } });
        await tx.organizationMembership.deleteMany({
          where: { userId: { in: userIds } },
        });
        await tx.parentStudentLink.deleteMany({
          where: {
            OR: [
              { organizationId },
              { parentUserId: { in: userIds } },
              { studentUserId: { in: userIds } },
            ],
          },
        });
      } else {
        await tx.organizationMembership.deleteMany({ where: { organizationId } });
        await tx.parentStudentLink.deleteMany({ where: { organizationId } });
      }

      const canceledSubscriptions = await tx.subscription.updateMany({
        where: {
          organizationId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
        },
        data: {
          status: SubscriptionStatus.CANCELED,
          endDate: deletedAt,
          seatUsage: 0,
        },
      });
      canceledSubscriptionCount = canceledSubscriptions.count;
      await tx.subscription.updateMany({
        where: {
          organizationId,
          status: { notIn: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
        },
        data: {
          seatUsage: 0,
        },
      });

      const canceledCheckoutSessions = await tx.checkoutSession.updateMany({
        where: { organizationId, status: CheckoutSessionStatus.PENDING },
        data: { status: CheckoutSessionStatus.CANCELED },
      });
      canceledCheckoutSessionCount = canceledCheckoutSessions.count;

      const disabledHardwareKeys = await tx.hardwareActivationKey.updateMany({
        where: {
          organizationId,
          status: { not: HardwareActivationKeyStatus.DISABLED },
        },
        data: { status: HardwareActivationKeyStatus.DISABLED },
      });
      disabledHardwareKeyCount = disabledHardwareKeys.count;

      const disabledHardwareActivations = await tx.hardwareActivation.updateMany({
        where: {
          organizationId,
          status: { not: HardwareActivationStatus.DISABLED },
        },
        data: { status: HardwareActivationStatus.DISABLED },
      });
      disabledHardwareActivationCount = disabledHardwareActivations.count;

      const disabledAiCreditAccounts = await tx.aiCreditAccount.updateMany({
        where: {
          organizationId,
          status: { not: AiCreditAccountStatus.DISABLED },
        },
        data: { status: AiCreditAccountStatus.DISABLED },
      });
      disabledAiCreditAccountCount = disabledAiCreditAccounts.count;

      const disconnectedStorageConnections = await tx.organizationStorageConnection.updateMany({
        where: { organizationId },
        data: {
          status: OrganizationStorageStatus.NOT_CONFIGURED,
          encryptedTokens: null,
          disconnectedAt: deletedAt,
          lastError: 'Organization archived by SoftLogic Super Admin',
        },
      });
      disconnectedStorageConnectionCount = disconnectedStorageConnections.count;
    });

    await this.logAudit(
      actor.userId,
      'organization.delete',
      'organization',
      organizationId,
      `Archived organization ${organization.name}`,
    );

    return {
      id: organizationId,
      deletedAt,
      archivedSlug,
      archivedSupportEmail,
      affectedUserCount: userIds.length,
      canceledSubscriptionCount,
      canceledCheckoutSessionCount,
      disabledHardwareKeyCount,
      disabledHardwareActivationCount,
      disabledAiCreditAccountCount,
      disconnectedStorageConnectionCount,
    };
  }

  async uploadOrganizationLogo(
    actor: AuthenticatedUserLike,
    organizationId: string,
    file?: Express.Multer.File,
  ) {
    await ensureOrganizationManaged(organizationId, actor);

    if (!file) {
      throw new AppError('Organization logo file is required.', 400);
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        logoPublicId: true,
      },
    });
    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    const upload = await uploadImageBuffer({
      buffer: file.buffer,
      filename: file.originalname,
      folder: `softlogic/organizations/${organizationId}`,
    });

    if (organization.logoPublicId) {
      await deleteImageAsset(organization.logoPublicId);
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        logoUrl: upload.url,
        logoPublicId: upload.publicId,
      },
      include: this.organizationInclude,
    });

    await this.logAudit(
      actor.userId,
      'organization.logo.upload',
      'organization',
      updated.id,
      `Updated organization logo for ${updated.name}`,
    );
    return updated;
  }

  async removeOrganizationLogo(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ) {
    await ensureOrganizationManaged(organizationId, actor);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        logoPublicId: true,
      },
    });
    if (!organization) {
      throw new AppError('Organization not found', 404);
    }

    await deleteImageAsset(organization.logoPublicId);

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        logoUrl: null,
        logoPublicId: null,
      },
      include: this.organizationInclude,
    });

    await this.logAudit(
      actor.userId,
      'organization.logo.remove',
      'organization',
      updated.id,
      `Removed organization logo for ${updated.name}`,
    );
    return updated;
  }

  async listUsers(
    actor: AuthenticatedUserLike,
    query: ListUsersQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const archivedOnly = csvHasValue(query.status, 'ARCHIVED');
    if (
      actor.role === UserRole.SUPER_ADMIN &&
      !query.organizationId &&
      query.scope !== 'ALL' &&
      !archivedOnly
    ) {
      return paginationMeta(
        [],
        0,
        query.page,
        options.exportAll ? query.perPage : query.perPage,
        {
          ...nonEmptyFilters(query),
          requiresOrganization: true,
        },
      );
    }
    const and: Prisma.UserWhereInput[] = [
      this.userScopeWhere(actor, managedOrganizationIds, {
        includeArchived: archivedOnly,
      }),
      archivedOnly ? { deletedAt: { not: null } } : { deletedAt: null },
    ];
    const roles = csvEnumValues(query.role, [
      UserRole.SUPER_ADMIN,
      UserRole.PARTNER_ADMIN,
      UserRole.CUSTOMER_ADMIN,
      UserRole.ADMIN,
      UserRole.TEACHER,
      UserRole.STUDENT,
      UserRole.PARENT,
    ]);
    const statuses = csvEnumValues(query.status, [
      UserStatus.ACTIVE,
      UserStatus.DISABLED,
    ]);
    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { primaryOrganization: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (roles) and.push({ role: { in: roles } });
    if (statuses) and.push({ status: { in: statuses } });
    if (query.organizationId) and.push({ primaryOrganizationId: query.organizationId });
    if (query.isEmailVerified !== undefined) {
      and.push({ isEmailVerified: query.isEmailVerified });
    }
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const lastLoginAt = dateRange(query.lastSeenFrom, query.lastSeenTo);
    if (lastLoginAt) and.push({ lastLoginAt });

    const where: Prisma.UserWhereInput = and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.UserOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['createdAt', 'updatedAt', 'email', 'name', 'role', 'status', 'lastLoginAt'],
      'createdAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        primaryOrganization: true,
      },
      }),
      prisma.user.count({ where }),
    ]);

    const usersWithSubscription = await Promise.all(
      users.map(async (user) => ({
        ...user,
        subscription: await prisma.subscription.findFirst({
          where: {
            OR: [
              { userId: user.id },
              ...(user.primaryOrganizationId
                ? [{ organizationId: user.primaryOrganizationId }]
                : []),
            ],
          },
          orderBy: { updatedAt: 'desc' },
        }),
      })),
    );

    return paginationMeta(
      usersWithSubscription,
      total,
      page,
      options.exportAll ? total || perPage : perPage,
      nonEmptyFilters(query),
    );
  }

  async getUser(actor: AuthenticatedUserLike, userId: string) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const scope = this.userScopeWhere(actor, managedOrganizationIds, {
      includeArchived: true,
    });
    const user = await prisma.user.findFirst({
      where: { AND: [{ id: userId }, scope] },
      include: {
        primaryOrganization: true,
        parentLinks: {
          where: { status: 'ACTIVE' },
          select: {
            studentUserId: true,
            studentUser: {
              select: {
                id: true,
                email: true,
                name: true,
                status: true,
                primaryOrganizationId: true,
              },
            },
          },
        },
      },
    });
    if (!user) throw new AppError('User not found', 404);
    const subscription = await prisma.subscription.findFirst({
      where: {
        OR: [
          { userId: user.id },
          ...(user.primaryOrganizationId
            ? [{ organizationId: user.primaryOrganizationId }]
            : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    const linkedStudents = user.parentLinks.map((link) => link.studentUser);
    return {
      ...user,
      parentLinks: undefined,
      linkedStudentIds: linkedStudents.map((student) => student.id),
      linkedStudents,
      subscription,
    };
  }

  async exportUsers(actor: AuthenticatedUserLike, query: ListUsersQuery & { format: AdminExportFormat }) {
    const result = await this.listUsers(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Users',
      fileBaseName: 'softlogic-users',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Name', key: 'name', width: 24, value: (row) => row.name ?? '' },
        { header: 'Email', key: 'email', width: 34, value: (row) => row.email },
        { header: 'Role', key: 'role', width: 20, value: (row) => ROLE_LABEL[row.role] },
        {
          header: 'Status',
          key: 'status',
          width: 16,
          value: (row) => (row.deletedAt ? 'Archived' : USER_STATUS_LABEL[row.status]),
        },
        { header: 'Organization', key: 'organization', width: 28, value: (row) => row.primaryOrganization?.name ?? '' },
        { header: 'Email Verified', key: 'verified', width: 16, value: (row) => row.isEmailVerified ? 'Yes' : 'No' },
        { header: 'Timezone', key: 'timezone', width: 18, value: (row) => row.timezone },
        { header: 'Language', key: 'language', width: 12, value: (row) => row.language },
        { header: 'Last Login', key: 'lastLoginAt', width: 22, value: (row) => row.lastLoginAt },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
      ],
    });
  }

  async createUser(actor: AuthenticatedUserLike, input: CreateUserInput) {
    if (!canManageRole(actor.role, input.role)) {
      throw new AppError('You do not have permission to assign this role', 403);
    }

    const email = normalizeEmail(input.email);
    if (!email) {
      throw new AppError('Email is required', 400);
    }
    const organizationId = await this.resolveOrganizationForUser(actor, input.organizationId ?? null);
    const existing = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('A user with this email already exists', 409);
    }

    if ((input.status ?? UserStatus.ACTIVE) === UserStatus.ACTIVE) {
      await licensingService.assertCanActivateUserRole({
        organizationId,
        role: input.role,
      });
    }

    const setupEmails: PasswordSetupEmailPayload[] = [];
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          name: input.name,
          role: input.role,
          status: input.status ?? UserStatus.ACTIVE,
          timezone: input.timezone ?? 'UTC',
          language: input.language ?? 'en',
          invitedById: actor.userId,
          primaryOrganizationId: organizationId,
        },
      });

      if (organizationId) {
        await tx.organizationMembership.create({
          data: {
            userId: createdUser.id,
            organizationId,
          },
        });
      }

      if (input.role === UserRole.PARENT && input.linkedStudentIds?.length) {
        await this.createParentStudentLinks(
          tx,
          createdUser.id,
          organizationId,
          input.linkedStudentIds,
        );
      }

      if (isAdminOnboardingRole(input.role)) {
        const setupToken = await this.createPasswordSetupToken(tx, createdUser.id);
        const organization = organizationId
          ? await tx.organization.findUnique({
              where: { id: organizationId },
              select: { name: true },
            })
          : null;
        setupEmails.push({
          to: createdUser.email,
          name: createdUser.name,
          role: createdUser.role,
          organizationName: organization?.name,
          setupUrl: this.passwordSetupUrl(setupToken),
        });
      }

      return createdUser;
    });

    if (organizationId) {
      await licensingService.recalculateLicenseUsage(organizationId);
    }

    await this.logAudit(actor.userId, 'user.create', 'user', user.id, `Created user ${user.email}`);
    const setupEmail = setupEmails[0];
    if (setupEmail) {
      const setupEmailSent = await sendPasswordSetupEmail({
        to: setupEmail.to,
        name: setupEmail.name,
        role: setupEmail.role,
        organizationName: setupEmail.organizationName,
        setupUrl: setupEmail.setupUrl,
        expiresInLabel: `${PASSWORD_SETUP_EXPIRY_DAYS} days`,
      });
      if (!setupEmailSent) {
        await this.logAudit(
          actor.userId,
          'user.setup_email_failed',
          'user',
          user.id,
          `Password setup email failed for ${setupEmail.to}`,
        );
      }
    } else {
      await sendWelcomeEmail({
        to: user.email,
        name: user.name,
        role: user.role,
      });
    }
    return findUserContextById(user.id);
  }

  async updateUser(
    actor: AuthenticatedUserLike,
    userId: string,
    input: UpdateUserInput,
  ) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: { primaryOrganization: true },
    });
    if (!existing || existing.deletedAt) {
      throw new AppError('User not found', 404);
    }

    if (input.role && !canManageRole(actor.role, input.role)) {
      throw new AppError('You do not have permission to assign this role', 403);
    }

    if (!canManageRole(actor.role, existing.role) && actor.role !== 'SUPER_ADMIN' && existing.id !== actor.userId) {
      throw new AppError('You do not have permission to manage this user', 403);
    }

    const organizationId = input.organizationId === undefined
      ? existing.primaryOrganizationId
      : await this.resolveOrganizationForUser(actor, input.organizationId);
    const nextRole = input.role ?? existing.role;
    const nextStatus = input.status ?? existing.status;

    if (nextStatus === UserStatus.ACTIVE) {
      await licensingService.assertCanActivateUserRole({
        organizationId,
        role: nextRole,
        userIdToIgnore: userId,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          role: input.role,
          status: input.status,
          timezone: input.timezone,
          language: input.language,
          primaryOrganizationId: organizationId,
        },
      });

      await tx.organizationMembership.deleteMany({
        where: { userId },
      });

      if (organizationId) {
        await tx.organizationMembership.create({
          data: {
            userId,
            organizationId,
          },
        });
      }

      if (nextRole === UserRole.PARENT && input.linkedStudentIds) {
        await tx.parentStudentLink.deleteMany({ where: { parentUserId: userId } });
        await this.createParentStudentLinks(
          tx,
          userId,
          organizationId,
          input.linkedStudentIds,
        );
      }
    });

    const affectedOrganizationIds = new Set(
      [existing.primaryOrganizationId, organizationId].filter(Boolean) as string[],
    );
    for (const affectedOrganizationId of affectedOrganizationIds) {
      await licensingService.recalculateLicenseUsage(affectedOrganizationId);
    }

    await this.logAudit(actor.userId, 'user.update', 'user', userId, `Updated user ${existing.email}`);
    return findUserContextById(userId);
  }

  async deleteUser(
    actor: AuthenticatedUserLike,
    userId: string,
  ): Promise<DeleteUserResult> {
    if (userId === actor.userId) {
      throw new AppError('You cannot delete your own account', 400);
    }

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { select: { organizationId: true } },
        primaryAdminOrganizations: { select: { id: true, supportEmail: true } },
      },
    });
    if (!existing || existing.deletedAt) {
      throw new AppError('User not found', 404);
    }

    if (!canManageRole(actor.role, existing.role) && actor.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('You do not have permission to delete this user', 403);
    }

    if (actor.role !== UserRole.SUPER_ADMIN) {
      const targetOrganizationIds = [
        existing.primaryOrganizationId,
        ...existing.memberships.map((membership) => membership.organizationId),
      ].filter(Boolean) as string[];
      const managedOrganizationIds = await getManagedOrganizationIds(actor);
      const canAccessTarget = targetOrganizationIds.some((organizationId) =>
        managedOrganizationIds?.includes(organizationId),
      );
      if (!canAccessTarget) {
        throw new AppError('You do not have permission to delete this user', 403);
      }
    }

    if (existing.role === UserRole.SUPER_ADMIN) {
      const remainingSuperAdmins = await prisma.user.count({
        where: {
          id: { not: userId },
          role: UserRole.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      });
      if (remainingSuperAdmins === 0) {
        throw new AppError('At least one active Super Admin must remain', 400);
      }
    }

    const deletedAt = new Date();
    const archivedEmail = existing.archivedEmail ?? existing.email;
    const replacementEmail = deletedEmailFor(existing.id);
    const affectedOrganizationIds = Array.from(
      new Set(
        [
          existing.primaryOrganizationId,
          ...existing.memberships.map((membership) => membership.organizationId),
          ...existing.primaryAdminOrganizations.map((organization) => organization.id),
        ].filter(Boolean) as string[],
      ),
    );

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: replacementEmail,
          archivedEmail,
          googleId: null,
          passwordHash: null,
          status: UserStatus.DISABLED,
          isEmailVerified: false,
          deletedAt,
        },
      });
      await tx.session.deleteMany({ where: { userId } });
      await tx.otp.deleteMany({ where: { userId } });
      await tx.organizationMembership.deleteMany({ where: { userId } });
      await tx.parentStudentLink.deleteMany({
        where: { OR: [{ parentUserId: userId }, { studentUserId: userId }] },
      });
      await tx.organization.updateMany({
        where: {
          OR: [
            { primaryAdminUserId: userId },
            { supportEmail: { equals: archivedEmail, mode: 'insensitive' } },
          ],
        },
        data: {
          primaryAdminUserId: null,
          archivedSupportEmail: archivedEmail,
          supportEmail: null,
        },
      });
    });

    const licenseSnapshots: Record<string, unknown> = {};
    for (const organizationId of affectedOrganizationIds) {
      licenseSnapshots[organizationId] =
        await licensingService.recalculateLicenseUsage(organizationId);
    }

    await this.logAudit(
      actor.userId,
      'user.delete',
      'user',
      userId,
      `Deleted user ${archivedEmail}`,
    );

    return {
      id: userId,
      deletedAt,
      archivedEmail,
      affectedOrganizationIds,
      licenseSnapshots,
    };
  }

  // #op Load a target user and enforce the same managed-org scope used by
  // updateUser/deleteUser: super admin can reach anyone; partner/customer/admin
  // can only reach users whose primary org or memberships fall within their
  // managed organizations.
  private async ensureManagedUser(
    actor: AuthenticatedUserLike,
    userId: string,
  ): Promise<
    Prisma.UserGetPayload<{ include: { memberships: { select: { organizationId: true } } } }>
  > {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { select: { organizationId: true } } },
    });
    if (!user || user.deletedAt) {
      throw new AppError('User not found', 404);
    }

    if (actor.role !== UserRole.SUPER_ADMIN) {
      if (!canManageRole(actor.role, user.role) && user.id !== actor.userId) {
        throw new AppError('You do not have permission to manage this user', 403);
      }
      const targetOrganizationIds = [
        user.primaryOrganizationId,
        ...user.memberships.map((membership) => membership.organizationId),
      ].filter(Boolean) as string[];
      const managedOrganizationIds = await getManagedOrganizationIds(actor);
      const canAccessTarget = targetOrganizationIds.some((organizationId) =>
        managedOrganizationIds?.includes(organizationId),
      );
      if (!canAccessTarget && user.id !== actor.userId) {
        throw new AppError('You do not have permission to manage this user', 403);
      }
    }

    return user;
  }

  async resendUserInvite(actor: AuthenticatedUserLike, userId: string) {
    const user = await this.ensureManagedUser(actor, userId);

    if (user.passwordHash !== null || user.isEmailVerified) {
      throw new AppError('User has already completed setup', 400);
    }

    const setupToken = await prisma.$transaction((tx) =>
      this.createPasswordSetupToken(tx, user.id),
    );
    const organization = user.primaryOrganizationId
      ? await prisma.organization.findUnique({
          where: { id: user.primaryOrganizationId },
          select: { name: true },
        })
      : null;

    await sendPasswordSetupEmail({
      to: user.email,
      name: user.name,
      role: user.role,
      organizationName: organization?.name,
      setupUrl: this.passwordSetupUrl(setupToken),
      expiresInLabel: `${PASSWORD_SETUP_EXPIRY_DAYS} days`,
    });

    await this.logAudit(
      actor.userId,
      'admin.user.resend_invite',
      'user',
      user.id,
      `Resent setup invite to ${user.email}`,
    );

    return { sent: true, email: user.email };
  }

  async forceLogoutUser(actor: AuthenticatedUserLike, userId: string) {
    const user = await this.ensureManagedUser(actor, userId);

    await authRepository.deleteAllUserSessions(user.id);

    try {
      await sendSessionsRevokedEmail({ to: user.email, name: user.name });
    } catch (error) {
      console.error(`Sessions revoked email failed for ${user.email}:`, error);
    }

    await this.logAudit(
      actor.userId,
      'admin.user.force_logout',
      'user',
      user.id,
      `Signed ${user.email} out of all devices`,
    );

    return { revoked: true };
  }

  async bulkInviteUsers(actor: AuthenticatedUserLike, input: BulkInviteInput) {
    const results: Array<{
      email: string;
      status: 'created' | 'failed';
      error?: string;
    }> = [];
    let created = 0;
    let failed = 0;

    for (const row of input.users) {
      try {
        await this.createUser(actor, {
          email: row.email,
          name: row.name ?? undefined,
          role: row.role,
          organizationId: row.organizationId ?? undefined,
        });
        created += 1;
        results.push({ email: row.email, status: 'created' });
      } catch (error) {
        failed += 1;
        const message =
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to invite user';
        results.push({ email: row.email, status: 'failed', error: message });
      }
    }

    await this.logAudit(
      actor.userId,
      'admin.user.bulk_invite',
      'user',
      actor.userId,
      `Bulk invite processed: ${created} created, ${failed} failed of ${input.users.length}`,
    );

    return { createdCount: created, failedCount: failed, results };
  }

  async impersonateUser(actor: AuthenticatedUserLike, userId: string) {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('Forbidden', 403);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!target || target.deletedAt) {
      throw new AppError('User not found', 404);
    }

    const accessToken = generateAccessToken({
      userId: target.id,
      email: target.email,
      role: target.role,
      organizationId: target.primaryOrganizationId,
    });

    await this.logAudit(
      actor.userId,
      'admin.user.impersonate',
      'user',
      target.id,
      `Impersonated user ${target.email} (${target.id})`,
    );

    return {
      accessToken,
      user: {
        id: target.id,
        email: target.email,
        name: target.name,
        role: target.role,
        primaryOrganizationId: target.primaryOrganizationId,
      },
    };
  }

  async listSubscriptions(
    actor: AuthenticatedUserLike,
    query: ListSubscriptionsQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const and: Prisma.SubscriptionWhereInput[] = [
      this.subscriptionScopeWhere(actor, managedOrganizationIds),
    ];
    const statuses = csvEnumValues(query.status, [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.TRIAL,
      SubscriptionStatus.PENDING_APPROVAL,
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELED,
    ]);
    const wantsArchived = csvHasValue(query.status, 'ARCHIVED');
    if (query.search) {
      and.push({
        OR: [
          { planName: { contains: query.search, mode: 'insensitive' } },
          { organization: { name: { contains: query.search, mode: 'insensitive' } } },
          { user: { name: { contains: query.search, mode: 'insensitive' } } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (wantsArchived) {
      and.push({ deletedAt: { not: null } });
      if (statuses) and.push({ status: { in: statuses } });
    } else {
      and.push({ deletedAt: null });
      if (statuses) and.push({ status: { in: statuses } });
    }
    if (query.planName) and.push({ planName: { contains: query.planName, mode: 'insensitive' } });
    if (query.organizationId) and.push({ organizationId: query.organizationId });
    if (query.userId) and.push({ userId: query.userId });
    const endDateExpiring = dateRange(query.expiringFrom, query.expiringTo);
    if (endDateExpiring) and.push({ endDate: endDateExpiring });
    if (query.seatUsageMin !== undefined || query.seatUsageMax !== undefined) {
      and.push({
        seatUsage: {
          ...(query.seatUsageMin !== undefined ? { gte: query.seatUsageMin } : {}),
          ...(query.seatUsageMax !== undefined ? { lte: query.seatUsageMax } : {}),
        },
      });
    }
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const startDate = dateRange(query.startFrom, query.startTo);
    if (startDate) and.push({ startDate });
    const endDate = dateRange(query.endFrom, query.endTo);
    if (endDate) and.push({ endDate });

    const where: Prisma.SubscriptionWhereInput = and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.SubscriptionOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['updatedAt', 'createdAt', 'startDate', 'endDate', 'planName', 'status', 'seatUsage', 'seatLimit'],
      'updatedAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;

    const [items, total] = await Promise.all([
      prisma.subscription.findMany({
      where,
      include: {
        organization: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy,
      skip,
      take,
      }),
      prisma.subscription.count({ where }),
    ]);

    return paginationMeta(
      items,
      total,
      page,
      options.exportAll ? total || perPage : perPage,
      nonEmptyFilters(query),
    );
  }

  async getSubscription(actor: AuthenticatedUserLike, subscriptionId: string) {
    const existing = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!existing) throw new AppError('Subscription not found', 404);
    if (existing.organizationId) {
      await ensureOrganizationManaged(existing.organizationId, actor);
    } else if (existing.userId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: existing.userId },
        select: { primaryOrganizationId: true },
      });
      if (targetUser?.primaryOrganizationId) {
        await ensureOrganizationManaged(targetUser.primaryOrganizationId, actor);
      }
    }
    return prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        organization: true,
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });
  }

  async exportSubscriptions(actor: AuthenticatedUserLike, query: ListSubscriptionsQuery & { format: AdminExportFormat }) {
    const result = await this.listSubscriptions(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Subscriptions',
      fileBaseName: 'softlogic-subscriptions',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Plan', key: 'planName', width: 24, value: (row) => row.planName },
        { header: 'Status', key: 'status', width: 16, value: (row) => SUBSCRIPTION_STATUS_LABEL[row.status] },
        { header: 'Scope Type', key: 'scopeType', width: 16, value: (row) => row.organizationId ? 'Organization' : 'User' },
        { header: 'Organization', key: 'organization', width: 28, value: (row) => row.organization?.name ?? '' },
        { header: 'User', key: 'user', width: 34, value: (row) => row.user?.email ?? row.user?.name ?? '' },
        { header: 'Seats Used', key: 'seatUsage', width: 14, value: (row) => row.seatUsage },
        { header: 'Number of Seats', key: 'seatLimit', width: 16, value: (row) => row.seatLimit },
        { header: 'Start Date', key: 'startDate', width: 22, value: (row) => row.startDate },
        { header: 'End Date', key: 'endDate', width: 22, value: (row) => row.endDate },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
        { header: 'Updated At', key: 'updatedAt', width: 22, value: (row) => row.updatedAt },
      ],
    });
  }

  async createSubscription(
    actor: AuthenticatedUserLike,
    input: CreateSubscriptionInput,
  ) {
    // Admins (partner/customer/admin) may now REQUEST a subscription, but it
    // lands in PENDING_APPROVAL and grants no seats until a Super Admin
    // approves it. Super Admins keep the existing instant-active behaviour and
    // full control over commercial fields (status, branding). The previous
    // `requireSuperAdmin` hard block is intentionally removed here.
    const isSuper = actor.role === UserRole.SUPER_ADMIN;

    // Resolve + authorize the owning organization (scoping unchanged).
    let ownerOrganizationId: string | null = input.organizationId ?? null;
    if (input.organizationId) {
      await ensureOrganizationManaged(input.organizationId, actor);
    } else if (input.userId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { primaryOrganizationId: true },
      });
      if (!targetUser) {
        throw new AppError('User not found', 404);
      }
      ownerOrganizationId = targetUser.primaryOrganizationId ?? null;
      if (targetUser.primaryOrganizationId) {
        await ensureOrganizationManaged(targetUser.primaryOrganizationId, actor);
      }
    }

    // Status + branding are commercial controls. Super Admin sets them freely;
    // for admins we force a pending request, inherit the org's branding, and
    // ignore client-sent seat usage (real usage is derived, never asserted).
    let status: SubscriptionStatus;
    let brandingMode: BrandingMode;
    if (isSuper) {
      status = input.status ?? SubscriptionStatus.ACTIVE;
      brandingMode = input.brandingMode ?? BrandingMode.SOFTLOGIC;
    } else {
      status = SubscriptionStatus.PENDING_APPROVAL;
      brandingMode = BrandingMode.SOFTLOGIC;
      if (ownerOrganizationId) {
        const org = await prisma.organization.findUnique({
          where: { id: ownerOrganizationId },
          select: { brandingMode: true },
        });
        brandingMode = org?.brandingMode ?? BrandingMode.SOFTLOGIC;
      }
    }

    const subscription = await prisma.subscription.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        createdById: actor.userId,
        planName: input.planName,
        status,
        brandingMode,
        seatLimit: input.seatLimit,
        seatUsage: 0,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
      },
      include: {
        organization: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (subscription.organizationId) {
      // No-op for pending subs (getActiveOrganizationSubscription filters to
      // ACTIVE/TRIAL), correct recompute for the super-admin instant path.
      await licensingService.recalculateLicenseUsage(subscription.organizationId);
    }
    await this.logAudit(
      actor.userId,
      isSuper ? 'subscription.create' : 'subscription.request',
      'subscription',
      subscription.id,
      isSuper
        ? `Created subscription ${subscription.planName}`
        : `Requested subscription ${subscription.planName} (pending approval)`,
    );

    // Admin requests acknowledge the creator and notify super admins. Email is
    // fire-and-forget so SMTP problems never roll back the created record.
    if (!isSuper) {
      await this.notifySubscriptionPending(actor, subscription);
    }

    return subscription;
  }

  async approveSubscription(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
  ) {
    await licensingService.requireSuperAdmin(actor);
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!existing) {
      throw new AppError('Subscription not found', 404);
    }
    // Only a pending request can be approved — protects a live ACTIVE
    // (paying) subscription from being mutated through this path.
    if (existing.status !== SubscriptionStatus.PENDING_APPROVAL) {
      throw new AppError('Only a pending subscription can be approved', 409);
    }

    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE },
      include: {
        organization: true,
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });

    if (subscription.organizationId) {
      await licensingService.recalculateLicenseUsage(subscription.organizationId);
    }
    await this.logAudit(
      actor.userId,
      'subscription.approve',
      'subscription',
      subscription.id,
      `Approved subscription ${subscription.planName}`,
    );
    await this.notifySubscriptionDecision(subscription, 'APPROVED');
    return subscription;
  }

  async rejectSubscription(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
    reason?: string | null,
  ) {
    await licensingService.requireSuperAdmin(actor);
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!existing) {
      throw new AppError('Subscription not found', 404);
    }
    if (existing.status !== SubscriptionStatus.PENDING_APPROVAL) {
      throw new AppError('Only a pending subscription can be rejected', 409);
    }

    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.CANCELED },
      include: {
        organization: true,
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });

    await this.logAudit(
      actor.userId,
      'subscription.reject',
      'subscription',
      subscription.id,
      reason
        ? `Rejected subscription ${subscription.planName}: ${reason}`
        : `Rejected subscription ${subscription.planName}`,
    );
    await this.notifySubscriptionDecision(subscription, 'REJECTED', reason);
    return subscription;
  }

  private async notifySubscriptionPending(
    actor: AuthenticatedUserLike,
    subscription: Prisma.SubscriptionGetPayload<{ include: { organization: true } }>,
  ) {
    const organizationName = subscription.organization?.name ?? null;
    const creator = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { email: true, name: true },
    });
    if (creator?.email) {
      await sendSubscriptionPendingEmail({
        to: creator.email,
        name: creator.name,
        planName: subscription.planName,
        organizationName,
        seatLimit: subscription.seatLimit,
      }).catch(() => undefined);
    }
    const superAdmins = await prisma.user.findMany({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: { email: true, name: true },
    });
    await Promise.all(
      superAdmins.map((admin) =>
        sendSubscriptionPendingEmail({
          to: admin.email,
          name: admin.name,
          planName: subscription.planName,
          organizationName,
          seatLimit: subscription.seatLimit,
          forSuperAdmin: true,
          requestedByName: creator?.name ?? null,
        }).catch(() => undefined),
      ),
    );
  }

  private async notifySubscriptionDecision(
    subscription: Prisma.SubscriptionGetPayload<{ include: { organization: true } }>,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string | null,
  ) {
    if (!subscription.createdById) return;
    const creator = await prisma.user.findUnique({
      where: { id: subscription.createdById },
      select: { email: true, name: true },
    });
    if (!creator?.email) return;
    const organizationName = subscription.organization?.name ?? null;
    if (decision === 'APPROVED') {
      await sendSubscriptionApprovedEmail({
        to: creator.email,
        name: creator.name,
        planName: subscription.planName,
        organizationName,
        seatLimit: subscription.seatLimit,
      }).catch(() => undefined);
    } else {
      await sendSubscriptionRejectedEmail({
        to: creator.email,
        name: creator.name,
        planName: subscription.planName,
        organizationName,
        reason: reason ?? null,
      }).catch(() => undefined);
    }
  }

  async updateSubscription(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ) {
    await licensingService.requireSuperAdmin(actor);
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!existing) {
      throw new AppError('Subscription not found', 404);
    }

    if (existing.organizationId) {
      await ensureOrganizationManaged(existing.organizationId, actor);
    } else if (existing.userId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: existing.userId },
        select: { primaryOrganizationId: true },
      });
      if (targetUser?.primaryOrganizationId) {
        await ensureOrganizationManaged(targetUser.primaryOrganizationId, actor);
      }
    }

    if (input.seatLimit !== undefined) {
      await licensingService.assertSubscriptionSeatCapacity(subscriptionId, input.seatLimit);
    }

    const { seatUsage: _ignoredSeatUsage, ...safeInput } = input;
    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        ...safeInput,
      },
      include: {
        organization: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (subscription.organizationId) {
      await licensingService.recalculateLicenseUsage(subscription.organizationId);
    }
    await this.logAudit(actor.userId, 'subscription.update', 'subscription', subscription.id, `Updated subscription ${subscription.planName}`);
    return subscription;
  }

  async deleteSubscription(actor: AuthenticatedUserLike, subscriptionId: string) {
    await licensingService.requireSuperAdmin(actor);
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!existing) throw new AppError('Subscription not found', 404);
    if (existing.organizationId) {
      await ensureOrganizationManaged(existing.organizationId, actor);
    }
    if (existing.deletedAt) return existing;

    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { deletedAt: new Date() },
      include: {
        organization: true,
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    if (subscription.organizationId) {
      await licensingService.recalculateLicenseUsage(subscription.organizationId);
    }
    await this.logAudit(
      actor.userId,
      'subscription.archive',
      'subscription',
      subscription.id,
      `Archived subscription ${subscription.planName}`,
    );
    return subscription;
  }

  async restoreSubscription(actor: AuthenticatedUserLike, subscriptionId: string) {
    await licensingService.requireSuperAdmin(actor);
    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!existing) throw new AppError('Subscription not found', 404);
    if (existing.organizationId) {
      await ensureOrganizationManaged(existing.organizationId, actor);
    }

    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { deletedAt: null },
      include: {
        organization: true,
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    if (subscription.organizationId) {
      await licensingService.recalculateLicenseUsage(subscription.organizationId);
    }
    await this.logAudit(
      actor.userId,
      'subscription.restore',
      'subscription',
      subscription.id,
      `Restored subscription ${subscription.planName}`,
    );
    return subscription;
  }

  async listPaymentProviders(actor: AuthenticatedUserLike) {
    return licensingService.listPaymentProviders(actor);
  }

  async updatePaymentProvider(
    actor: AuthenticatedUserLike,
    input: UpdatePaymentProviderInput,
  ) {
    return licensingService.updatePaymentProvider(actor, input);
  }

  async recordOfflinePayment(
    actor: AuthenticatedUserLike,
    input: {
      organizationId?: string | null;
      subscriptionId?: string | null;
      amountMinor: number;
      currency?: string;
      referenceNote?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) {
    return licensingService.recordOfflinePayment(actor, input);
  }

  async createHardwareActivationKey(
    actor: AuthenticatedUserLike,
    input: {
      organizationId: string;
      subscriptionId?: string | null;
      assignedUserId?: string | null;
      label?: string | null;
      expiresAt?: Date | null;
      maxDevices?: number | null;
    },
  ) {
    return licensingService.createHardwareActivationKey(actor, input);
  }

  async bulkCreateHardwareActivationKeys(
    actor: AuthenticatedUserLike,
    input: Parameters<typeof licensingService.bulkCreateHardwareActivationKeys>[1],
  ) {
    return licensingService.bulkCreateHardwareActivationKeys(actor, input);
  }

  async exportHardwareActivationKeys(
    actor: AuthenticatedUserLike,
    input: Parameters<typeof licensingService.exportHardwareActivationKeys>[1],
  ) {
    return licensingService.exportHardwareActivationKeys(actor, input);
  }

  async listSubscriptionPayments(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
  ) {
    return licensingService.listSubscriptionPayments(actor, subscriptionId);
  }

  async renewSubscription(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
    input: {
      newEndDate: Date;
      extendKeys?: boolean;
      payment?: {
        amountMinor: number;
        currency?: string | null;
        referenceNote?: string | null;
      } | null;
    },
  ) {
    return licensingService.renewSubscription(actor, subscriptionId, input);
  }

  async resetHardwareActivation(
    actor: AuthenticatedUserLike,
    activationId: string,
  ) {
    return licensingService.resetHardwareActivation(actor, activationId);
  }

  async revokeHardwareActivationKey(
    actor: AuthenticatedUserLike,
    keyId: string,
  ) {
    return licensingService.revokeHardwareActivationKey(actor, keyId);
  }

  async replaceHardwareActivationKey(
    actor: AuthenticatedUserLike,
    keyId: string,
  ) {
    return licensingService.replaceHardwareActivationKey(actor, keyId);
  }

  async getSubscriptionDetails(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
  ) {
    return licensingService.getSubscriptionDetails(actor, subscriptionId);
  }

  async getOrganizationLicenseDetails(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ) {
    return licensingService.getOrganizationLicenseDetails(actor, organizationId);
  }

  async emailActivationKeysToOrgAdmin(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ) {
    return licensingService.emailActivationKeysToOrgAdmin(actor, organizationId);
  }

  async extendAiCredits(
    actor: AuthenticatedUserLike,
    input: Parameters<typeof licensingService.extendAiCredits>[1],
  ) {
    return licensingService.extendAiCredits(actor, input);
  }

  async recalculateOrganizationLicenseUsage(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ) {
    await licensingService.requireSuperAdmin(actor);
    await ensureOrganizationManaged(organizationId, actor);
    const snapshot = await licensingService.recalculateLicenseUsage(organizationId);
    await this.logAudit(actor.userId, 'license.recalculate', 'organization', organizationId, 'Recalculated role-specific license usage');
    return snapshot;
  }

  async upsertOrganizationStorageConnection(
    actor: AuthenticatedUserLike,
    organizationId: string,
    input: {
      provider: OrganizationStorageProvider;
      status: OrganizationStorageStatus;
      externalAccountEmail?: string | null;
      rootFolderId?: string | null;
      encryptedTokens?: string | null;
      lastError?: string | null;
    },
  ) {
    await ensureOrganizationManaged(organizationId, actor);
    if (actor.role !== UserRole.SUPER_ADMIN && actor.role !== UserRole.PARTNER_ADMIN) {
      throw new AppError('Only Super Admin or assigned Partner Admin can configure organization storage', 403);
    }
    const connection = await prisma.organizationStorageConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider: input.provider,
        },
      },
      update: {
        status: input.status,
        externalAccountEmail: input.externalAccountEmail,
        rootFolderId: input.rootFolderId,
        encryptedTokens: input.encryptedTokens,
        lastError: input.lastError,
        connectedById: actor.userId,
        validatedAt: input.status === OrganizationStorageStatus.CONNECTED ? new Date() : undefined,
        disconnectedAt: input.status === OrganizationStorageStatus.NOT_CONFIGURED ? new Date() : null,
      },
      create: {
        organizationId,
        provider: input.provider,
        status: input.status,
        externalAccountEmail: input.externalAccountEmail,
        rootFolderId: input.rootFolderId,
        encryptedTokens: input.encryptedTokens,
        lastError: input.lastError,
        connectedById: actor.userId,
        validatedAt: input.status === OrganizationStorageStatus.CONNECTED ? new Date() : undefined,
      },
    });
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        storageProviders: true,
        storageProvider: true,
      },
    });
    const storageProviders = Array.from(
      new Set([...(organization?.storageProviders ?? []), input.provider]),
    );
    const defaultProvider = organization?.storageProvider ?? input.provider;

    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        storageProviders: {
          set: storageProviders,
        },
        storageProvider: defaultProvider,
        storageStatus:
          defaultProvider === input.provider ? input.status : undefined,
      },
    });
    await this.logAudit(actor.userId, 'organization.storage.upsert', 'organization', organizationId, `Updated ${input.provider} storage connection`);
    return connection;
  }

  async listActivity(
    actor: AuthenticatedUserLike,
    query: ListActivityQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const and: Prisma.AdminAuditLogWhereInput[] = [
      this.activityScopeWhere(actor, managedOrganizationIds),
    ];
    if (query.search) {
      and.push({
        OR: [
          { action: { contains: query.search, mode: 'insensitive' } },
          { targetType: { contains: query.search, mode: 'insensitive' } },
          { targetId: { contains: query.search, mode: 'insensitive' } },
          { summary: { contains: query.search, mode: 'insensitive' } },
          { actorUser: { email: { contains: query.search, mode: 'insensitive' } } },
          { actorUser: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.actorUserId) and.push({ actorUserId: query.actorUserId });
    if (query.action) and.push({ action: { contains: query.action, mode: 'insensitive' } });
    if (query.targetType) and.push({ targetType: { contains: query.targetType, mode: 'insensitive' } });
    if (query.targetId) and.push({ targetId: { contains: query.targetId, mode: 'insensitive' } });
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const where: Prisma.AdminAuditLogWhereInput = { AND: and };
    const orderBy = this.orderBy<Prisma.AdminAuditLogOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['createdAt', 'action', 'targetType'],
      'createdAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;

    const [items, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
      include: {
        actorUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
        orderBy,
        skip,
        take,
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    return paginationMeta(
      items,
      total,
      page,
      options.exportAll ? total || perPage : perPage,
      nonEmptyFilters(query),
    );
  }

  async exportActivity(actor: AuthenticatedUserLike, query: ListActivityQuery & { format: AdminExportFormat }) {
    const result = await this.listActivity(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Activity',
      fileBaseName: 'softlogic-activity',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Actor', key: 'actor', width: 34, value: (row) => row.actorUser?.email ?? '' },
        { header: 'Actor Role', key: 'actorRole', width: 20, value: (row) => row.actorUser?.role ? ROLE_LABEL[row.actorUser.role] : '' },
        { header: 'Action', key: 'action', width: 26, value: (row) => row.action },
        { header: 'Target Type', key: 'targetType', width: 18, value: (row) => row.targetType },
        { header: 'Target ID', key: 'targetId', width: 38, value: (row) => row.targetId ?? '' },
        { header: 'Summary', key: 'summary', width: 60, value: (row) => row.summary ?? '' },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
      ],
    });
  }

  async listContentCanvases(
    actor: AuthenticatedUserLike,
    query: ListContentCanvasesQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const and: Prisma.CanvasWhereInput[] = [
      this.canvasScopeWhere(actor, managedOrganizationIds),
    ];
    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
          { user: { name: { contains: query.search, mode: 'insensitive' } } },
          { organization: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.organizationId) and.push({ organizationId: query.organizationId });
    if (query.userId) and.push({ userId: query.userId });
    if (query.role) and.push({ user: { role: query.role } });
    if (query.isPublic !== undefined) and.push({ isPublic: query.isPublic });
    if (query.hasThumbnail !== undefined) {
      and.push({ thumbnail: query.hasThumbnail ? { not: null } : null });
    }
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const updatedAt = dateRange(query.updatedFrom, query.updatedTo);
    if (updatedAt) and.push({ updatedAt });

    const where: Prisma.CanvasWhereInput = and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.CanvasOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['updatedAt', 'createdAt', 'name'],
      'updatedAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;
    const [items, total] = await Promise.all([
      prisma.canvas.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          user: { select: { id: true, email: true, name: true, role: true } },
          organization: { select: { id: true, name: true, slug: true, kind: true, status: true, logoUrl: true, parentOrganizationId: true } },
          slides: { orderBy: { order: 'asc' }, take: 1 },
          _count: { select: { slides: true, exports: true, liveSessions: true } },
        },
      }),
      prisma.canvas.count({ where }),
    ]);

    return paginationMeta(items, total, page, options.exportAll ? total || perPage : perPage, nonEmptyFilters(query));
  }

  async getContentCanvas(actor: AuthenticatedUserLike, canvasId: string) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const canvas = await prisma.canvas.findFirst({
      where: {
        AND: [this.canvasScopeWhere(actor, managedOrganizationIds), { id: canvasId }],
      },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        organization: true,
        slides: { orderBy: { order: 'asc' }, take: 24 },
        exports: { orderBy: { createdAt: 'desc' }, take: 10 },
        liveSessions: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { slides: true, exports: true, liveSessions: true } },
      },
    });
    if (!canvas) throw new AppError('Canvas not found', 404);
    return canvas;
  }

  async exportContentCanvases(actor: AuthenticatedUserLike, query: ListContentCanvasesQuery & { format: AdminExportFormat }) {
    const result = await this.listContentCanvases(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Content Canvases',
      fileBaseName: 'softlogic-content-canvases',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Name', key: 'name', width: 30, value: (row) => row.name },
        { header: 'Owner', key: 'owner', width: 34, value: (row) => row.user.email },
        { header: 'Organization', key: 'organization', width: 28, value: (row) => row.organization?.name ?? '' },
        { header: 'Public', key: 'public', width: 12, value: (row) => row.isPublic ? 'Yes' : 'No' },
        { header: 'Slides', key: 'slides', width: 12, value: (row) => row._count.slides },
        { header: 'Exports', key: 'exports', width: 12, value: (row) => row._count.exports },
        { header: 'Live Sessions', key: 'liveSessions', width: 16, value: (row) => row._count.liveSessions },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
        { header: 'Updated At', key: 'updatedAt', width: 22, value: (row) => row.updatedAt },
      ],
    });
  }

  async listContentLiveSessions(
    actor: AuthenticatedUserLike,
    query: ListContentLiveSessionsQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const and: Prisma.LiveSessionWhereInput[] = [
      this.liveSessionScopeWhere(actor, managedOrganizationIds),
    ];
    const statuses = csvEnumValues(query.status, [
      LiveSessionStatus.SCHEDULED,
      LiveSessionStatus.LIVE,
      LiveSessionStatus.ENDED,
      LiveSessionStatus.CANCELLED,
    ]);
    if (query.search) {
      and.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { canvas: { name: { contains: query.search, mode: 'insensitive' } } },
          { createdBy: { email: { contains: query.search, mode: 'insensitive' } } },
          { host: { email: { contains: query.search, mode: 'insensitive' } } },
          { organization: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (statuses) and.push({ status: { in: statuses } });
    if (query.organizationId) and.push({ organizationId: query.organizationId });
    if (query.userId) and.push({ OR: [{ createdById: query.userId }, { hostUserId: query.userId }] });
    if (query.role) and.push({ OR: [{ createdBy: { role: query.role } }, { host: { role: query.role } }] });
    if (query.canvasId) and.push({ canvasId: query.canvasId });
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const startedAt = dateRange(query.startedFrom, query.startedTo);
    if (startedAt) and.push({ startedAt });
    const endedAt = dateRange(query.endedFrom, query.endedTo);
    if (endedAt) and.push({ endedAt });

    const where: Prisma.LiveSessionWhereInput = and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.LiveSessionOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['updatedAt', 'createdAt', 'startedAt', 'endedAt', 'status'],
      'createdAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;
    const [items, total] = await Promise.all([
      prisma.liveSession.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          canvas: { select: { id: true, name: true, thumbnail: true } },
          organization: { select: { id: true, name: true, slug: true, kind: true, status: true, logoUrl: true, parentOrganizationId: true } },
          createdBy: { select: { id: true, email: true, name: true, role: true } },
          host: { select: { id: true, email: true, name: true, role: true } },
          _count: { select: { participants: true, messages: true, mediaAssets: true, recordings: true, events: true } },
        },
      }),
      prisma.liveSession.count({ where }),
    ]);

    return paginationMeta(items, total, page, options.exportAll ? total || perPage : perPage, nonEmptyFilters(query));
  }

  async getContentLiveSession(actor: AuthenticatedUserLike, liveSessionId: string) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const liveSession = await prisma.liveSession.findFirst({
      where: {
        AND: [this.liveSessionScopeWhere(actor, managedOrganizationIds), { id: liveSessionId }],
      },
      include: {
        canvas: true,
        organization: true,
        createdBy: { select: { id: true, email: true, name: true, role: true } },
        host: { select: { id: true, email: true, name: true, role: true } },
        participants: { include: { user: { select: { id: true, email: true, name: true, role: true } } }, take: 50 },
        messages: { orderBy: { createdAt: 'desc' }, take: 20 },
        mediaAssets: { orderBy: { createdAt: 'desc' }, take: 20 },
        recordings: { orderBy: { createdAt: 'desc' }, take: 10 },
        events: { orderBy: { createdAt: 'desc' }, take: 30 },
        _count: { select: { participants: true, messages: true, mediaAssets: true, recordings: true, events: true } },
      },
    });
    if (!liveSession) throw new AppError('Live session not found', 404);
    return liveSession;
  }

  async exportContentLiveSessions(actor: AuthenticatedUserLike, query: ListContentLiveSessionsQuery & { format: AdminExportFormat }) {
    const result = await this.listContentLiveSessions(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Content Live Sessions',
      fileBaseName: 'softlogic-content-live-sessions',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Title', key: 'title', width: 30, value: (row) => row.title ?? row.canvas.name },
        { header: 'Status', key: 'status', width: 16, value: (row) => LIVE_SESSION_STATUS_LABEL[row.status] },
        { header: 'Canvas', key: 'canvas', width: 30, value: (row) => row.canvas.name },
        { header: 'Organization', key: 'organization', width: 28, value: (row) => row.organization?.name ?? '' },
        { header: 'Created By', key: 'createdBy', width: 34, value: (row) => row.createdBy.email },
        { header: 'Host', key: 'host', width: 34, value: (row) => row.host?.email ?? '' },
        { header: 'Participants', key: 'participants', width: 14, value: (row) => row._count.participants },
        { header: 'Messages', key: 'messages', width: 12, value: (row) => row._count.messages },
        { header: 'Started At', key: 'startedAt', width: 22, value: (row) => row.startedAt },
        { header: 'Ended At', key: 'endedAt', width: 22, value: (row) => row.endedAt },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
      ],
    });
  }

  async listContentExports(
    actor: AuthenticatedUserLike,
    query: ListContentExportsQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const and: Prisma.ExportWhereInput[] = [
      this.exportScopeWhere(actor, managedOrganizationIds),
    ];
    const statuses = csvEnumValues(query.status, [
      ExportStatus.PENDING,
      ExportStatus.PROCESSING,
      ExportStatus.COMPLETED,
      ExportStatus.FAILED,
    ]);
    const formats = csvEnumValues(query.format, [
      ExportFormat.PDF,
      ExportFormat.PNG,
      ExportFormat.JPG,
      ExportFormat.SVG,
    ]);
    if (query.search) {
      and.push({
        OR: [
          { canvas: { name: { contains: query.search, mode: 'insensitive' } } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
          { user: { name: { contains: query.search, mode: 'insensitive' } } },
          { fileUrl: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (statuses) and.push({ status: { in: statuses } });
    if (formats) and.push({ format: { in: formats } });
    if (query.organizationId) and.push({ canvas: { organizationId: query.organizationId } });
    if (query.userId) and.push({ userId: query.userId });
    if (query.role) and.push({ user: { role: query.role } });
    if (query.canvasId) and.push({ canvasId: query.canvasId });
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const completedAt = dateRange(query.completedFrom, query.completedTo);
    if (completedAt) and.push({ completedAt });

    const where: Prisma.ExportWhereInput = and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.ExportOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['createdAt', 'completedAt', 'status', 'format', 'fileSize'],
      'createdAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;
    const [items, total] = await Promise.all([
      prisma.export.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          canvas: { include: { organization: { select: { id: true, name: true, slug: true, kind: true, status: true, logoUrl: true, parentOrganizationId: true } } } },
          user: { select: { id: true, email: true, name: true, role: true } },
        },
      }),
      prisma.export.count({ where }),
    ]);

    return paginationMeta(items, total, page, options.exportAll ? total || perPage : perPage, nonEmptyFilters(query));
  }

  async getContentExport(actor: AuthenticatedUserLike, exportId: string) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const exportRecord = await prisma.export.findFirst({
      where: {
        AND: [this.exportScopeWhere(actor, managedOrganizationIds), { id: exportId }],
      },
      include: {
        canvas: { include: { organization: true, slides: { orderBy: { order: 'asc' }, take: 12 } } },
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    if (!exportRecord) throw new AppError('Export not found', 404);
    return exportRecord;
  }

  async exportContentExports(actor: AuthenticatedUserLike, query: ListContentExportsQuery & { format: AdminExportFormat }) {
    const result = await this.listContentExports(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Content Exports',
      fileBaseName: 'softlogic-content-exports',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Canvas', key: 'canvas', width: 30, value: (row) => row.canvas.name },
        { header: 'User', key: 'user', width: 34, value: (row) => row.user.email },
        { header: 'Organization', key: 'organization', width: 28, value: (row) => row.canvas.organization?.name ?? '' },
        { header: 'Format', key: 'format', width: 12, value: (row) => row.format },
        { header: 'Status', key: 'status', width: 16, value: (row) => EXPORT_STATUS_LABEL[row.status] },
        { header: 'Role', key: 'role', width: 18, value: (row) => ROLE_LABEL[row.user.role] },
        { header: 'File Name', key: 'fileName', width: 34, value: (row) => row.fileName ?? '' },
        { header: 'MIME Type', key: 'mimeType', width: 28, value: (row) => row.mimeType ?? '' },
        { header: 'Storage Key', key: 'storageKey', width: 60, value: (row) => row.storageKey ?? '' },
        { header: 'File Size', key: 'fileSize', width: 14, value: (row) => row.fileSize ?? 0 },
        { header: 'File URL', key: 'fileUrl', width: 50, value: (row) => row.fileUrl ?? '' },
        { header: 'Error', key: 'error', width: 50, value: (row) => row.error ?? '' },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
        { header: 'Completed At', key: 'completedAt', width: 22, value: (row) => row.completedAt },
      ],
    });
  }

  async listContentImports(
    actor: AuthenticatedUserLike,
    query: ListContentImportsQuery,
    options: { exportAll?: boolean } = {},
  ) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const and: Prisma.ContentImportWhereInput[] = [
      this.importScopeWhere(actor, managedOrganizationIds),
    ];
    if (query.search) {
      and.push({
        OR: [
          { sourceName: { contains: query.search, mode: 'insensitive' } },
          { mimeType: { contains: query.search, mode: 'insensitive' } },
          { storageKey: { contains: query.search, mode: 'insensitive' } },
          { publicUrl: { contains: query.search, mode: 'insensitive' } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
          { user: { name: { contains: query.search, mode: 'insensitive' } } },
          { organization: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    if (query.organizationId) and.push({ organizationId: query.organizationId });
    if (query.userId) and.push({ userId: query.userId });
    if (query.role) and.push({ userRole: query.role });
    const createdAt = dateRange(query.createdFrom, query.createdTo);
    if (createdAt) and.push({ createdAt });
    const convertedAt = dateRange(query.convertedFrom, query.convertedTo);
    if (convertedAt) and.push({ convertedAt });

    const where: Prisma.ContentImportWhereInput = and.length === 1 ? and[0] : { AND: and };
    const orderBy = this.orderBy<Prisma.ContentImportOrderByWithRelationInput>(
      query.sortBy,
      query.sortOrder,
      ['createdAt', 'convertedAt', 'status', 'sourceName', 'sizeBytes'],
      'createdAt',
    );
    const page = query.page;
    const perPage = query.perPage;
    const skip = options.exportAll ? undefined : (page - 1) * perPage;
    const take = options.exportAll ? undefined : perPage;
    const [items, total] = await Promise.all([
      prisma.contentImport.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          user: { select: { id: true, email: true, name: true, role: true } },
          organization: { select: { id: true, name: true, slug: true, kind: true, status: true, logoUrl: true, parentOrganizationId: true } },
        },
      }),
      prisma.contentImport.count({ where }),
    ]);

    return paginationMeta(items, total, page, options.exportAll ? total || perPage : perPage, nonEmptyFilters(query));
  }

  async getContentImport(actor: AuthenticatedUserLike, importId: string) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const importRecord = await prisma.contentImport.findFirst({
      where: {
        AND: [this.importScopeWhere(actor, managedOrganizationIds), { id: importId }],
      },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        organization: true,
      },
    });
    if (!importRecord) throw new AppError('Import not found', 404);
    return importRecord;
  }

  async exportContentImports(actor: AuthenticatedUserLike, query: ListContentImportsQuery & { format: AdminExportFormat }) {
    const result = await this.listContentImports(actor, query, { exportAll: true });
    return buildAdminExport({
      title: 'Content Imports',
      fileBaseName: 'softlogic-content-imports',
      format: query.format,
      rows: result.items,
      filters: result.filters,
      columns: [
        { header: 'Source Name', key: 'sourceName', width: 34, value: (row) => row.sourceName },
        { header: 'User', key: 'user', width: 34, value: (row) => row.user.email },
        { header: 'Role', key: 'role', width: 18, value: (row) => ROLE_LABEL[row.userRole] },
        { header: 'Organization', key: 'organization', width: 28, value: (row) => row.organization?.name ?? '' },
        { header: 'Status', key: 'status', width: 16, value: (row) => CONTENT_IMPORT_STATUS_LABEL[row.status] },
        { header: 'MIME Type', key: 'mimeType', width: 28, value: (row) => row.mimeType ?? '' },
        { header: 'File Size', key: 'sizeBytes', width: 14, value: (row) => row.sizeBytes ?? 0 },
        { header: 'Storage Key', key: 'storageKey', width: 60, value: (row) => row.storageKey ?? '' },
        { header: 'Public URL', key: 'publicUrl', width: 50, value: (row) => row.publicUrl ?? '' },
        { header: 'Error', key: 'error', width: 50, value: (row) => row.error ?? '' },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
        { header: 'Converted At', key: 'convertedAt', width: 22, value: (row) => row.convertedAt },
      ],
    });
  }

  private resolveStorageSelection(input: {
    storageProviders?: OrganizationStorageProvider[];
    defaultStorageProvider?: OrganizationStorageProvider | null;
    storageProvider?: OrganizationStorageProvider | null;
    storageStatus?: OrganizationStorageStatus;
  }): {
    providers: OrganizationStorageProvider[];
    defaultProvider: OrganizationStorageProvider | null;
    status: OrganizationStorageStatus;
  } {
    const providers = Array.from(
      new Set(
        [
          ...(input.storageProviders ?? []),
          input.defaultStorageProvider ?? null,
          input.storageProvider ?? null,
        ].filter(Boolean) as OrganizationStorageProvider[],
      ),
    );
    const defaultProvider =
      input.defaultStorageProvider ??
      input.storageProvider ??
      providers[0] ??
      null;
    if (defaultProvider && !providers.includes(defaultProvider)) {
      providers.push(defaultProvider);
    }

    return {
      providers,
      defaultProvider,
      status:
        defaultProvider == null
          ? OrganizationStorageStatus.NOT_CONFIGURED
          : input.storageStatus ?? OrganizationStorageStatus.NOT_CONFIGURED,
    };
  }

  private async syncOrganizationStorageConnections(
    tx: Prisma.TransactionClient,
    organizationId: string,
    storage: {
      providers: OrganizationStorageProvider[];
      defaultProvider: OrganizationStorageProvider | null;
      status: OrganizationStorageStatus;
    },
  ): Promise<void> {
    if (storage.providers.length === 0) {
      await tx.organizationStorageConnection.deleteMany({
        where: { organizationId },
      });
      return;
    }

    await tx.organizationStorageConnection.deleteMany({
      where: {
        organizationId,
        provider: { notIn: storage.providers },
      },
    });
    for (const provider of storage.providers) {
      await tx.organizationStorageConnection.upsert({
        where: {
          organizationId_provider: {
            organizationId,
            provider,
          },
        },
        update: {},
        create: {
          organizationId,
          provider,
          status:
            provider === storage.defaultProvider
              ? storage.status
              : OrganizationStorageStatus.NOT_CONFIGURED,
        },
      });
    }
  }

  private async ensureSupportEmailAvailable(
    supportEmail: string,
    options: {
      organizationId?: string;
      allowedUserId?: string;
    } = {},
  ): Promise<void> {
    const user = await prisma.user.findFirst({
      where: {
        email: supportEmail,
        deletedAt: null,
        ...(options.allowedUserId ? { id: { not: options.allowedUserId } } : {}),
      },
      select: { id: true },
    });
    if (user) {
      throw new AppError('Support email already exists as a user account', 409);
    }

    const organization = await prisma.organization.findFirst({
      where: {
        supportEmail: { equals: supportEmail, mode: 'insensitive' },
        deletedAt: null,
        ...(options.organizationId ? { id: { not: options.organizationId } } : {}),
      },
      select: { id: true },
    });
    if (organization) {
      throw new AppError('Support email already exists on another organization', 409);
    }
  }

  private async createPasswordSetupToken(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    await tx.otp.updateMany({
      where: {
        userId,
        type: OtpType.PASSWORD_RESET,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    const secret = randomBytes(32).toString('hex');
    const otp = await tx.otp.create({
      data: {
        userId,
        type: OtpType.PASSWORD_RESET,
        code: await bcrypt.hash(secret, 10),
        expiresAt: new Date(Date.now() + PASSWORD_SETUP_EXPIRY_DAYS * DAY_MS),
      },
    });
    return `${otp.id}.${secret}`;
  }

  private passwordSetupUrl(token: string): string {
    const baseUrl = (env.PUBLIC_ADMIN_URL || env.PUBLIC_APP_URL).replace(/\/+$/, '');
    return `${baseUrl}/setup-password?token=${encodeURIComponent(token)}`;
  }

  private orderBy<T extends Record<string, unknown>>(
    requested: string | undefined,
    direction: 'asc' | 'desc',
    allowed: readonly string[],
    fallback: string,
    fallbackDirection: 'asc' | 'desc' = 'desc',
  ): T {
    const key = requested && allowed.includes(requested) ? requested : fallback;
    const order = requested && allowed.includes(requested) ? direction : fallbackDirection;
    return { [key]: order } as T;
  }

  private async resolveOrganizationForUser(
    actor: AuthenticatedUserLike,
    requestedOrganizationId: string | null,
  ): Promise<string | null> {
    if (!requestedOrganizationId) {
      if (actor.role === 'PARTNER_ADMIN' || actor.role === 'CUSTOMER_ADMIN' || actor.role === 'ADMIN') {
        return actor.organizationId ?? null;
      }
      return null;
    }

    await ensureOrganizationManaged(requestedOrganizationId, actor);
    return requestedOrganizationId;
  }

  private async createParentStudentLinks(
    tx: Prisma.TransactionClient,
    parentUserId: string,
    organizationId: string | null,
    studentIds: string[],
  ): Promise<void> {
    if (!organizationId) {
      throw new AppError('Parent users must belong to an organization before linking students', 400);
    }
    const uniqueStudentIds = Array.from(new Set(studentIds.filter(Boolean)));
    if (uniqueStudentIds.length === 0) return;

    const students = await tx.user.findMany({
      where: {
        id: { in: uniqueStudentIds },
        role: UserRole.STUDENT,
        primaryOrganizationId: organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (students.length !== uniqueStudentIds.length) {
      throw new AppError('Parents can only be linked to students in the same organization', 400);
    }

    await tx.parentStudentLink.createMany({
      data: uniqueStudentIds.map((studentUserId) => ({
        parentUserId,
        studentUserId,
        organizationId,
      })),
      skipDuplicates: true,
    });
  }

  private userScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
    options: { includeArchived?: boolean } = {},
  ): Prisma.UserWhereInput {
    if (managedOrganizationIds === null) {
      return options.includeArchived ? {} : { deletedAt: null };
    }

    return {
      ...(options.includeArchived ? {} : { deletedAt: null }),
      OR: [
        { id: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [{ primaryOrganizationId: { in: managedOrganizationIds } }]
          : []),
      ],
    };
  }

  private organizationScopeWhere(
    managedOrganizationIds: string[] | null,
    options: { includeArchived?: boolean } = {},
  ): Prisma.OrganizationWhereInput {
    if (managedOrganizationIds === null) {
      return options.includeArchived ? {} : { deletedAt: null };
    }
    return {
      id: { in: managedOrganizationIds },
      ...(options.includeArchived ? {} : { deletedAt: null }),
    };
  }

  private subscriptionScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.SubscriptionWhereInput {
    if (managedOrganizationIds === null) {
      return {};
    }

    return {
      OR: [
        { userId: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [
              { organizationId: { in: managedOrganizationIds } },
              { user: { primaryOrganizationId: { in: managedOrganizationIds } } },
            ]
          : []),
      ],
    };
  }

  private canvasScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.CanvasWhereInput {
    if (managedOrganizationIds === null) {
      return { deletedAt: null };
    }

    return {
      deletedAt: null,
      OR: [
        { userId: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [{ organizationId: { in: managedOrganizationIds } }]
          : []),
      ],
    };
  }

  private liveSessionScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.LiveSessionWhereInput {
    if (managedOrganizationIds === null) {
      return {};
    }

    return {
      OR: [
        { createdById: actor.userId },
        { hostUserId: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [{ organizationId: { in: managedOrganizationIds } }]
          : []),
      ],
    };
  }

  private exportScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.ExportWhereInput {
    if (managedOrganizationIds === null) {
      return {};
    }

    return {
      OR: [
        { userId: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [
              { user: { primaryOrganizationId: { in: managedOrganizationIds } } },
              { canvas: { organizationId: { in: managedOrganizationIds } } },
            ]
          : []),
      ],
    };
  }

  private importScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.ContentImportWhereInput {
    if (managedOrganizationIds === null) {
      return {};
    }

    return {
      OR: [
        { userId: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [
              { organizationId: { in: managedOrganizationIds } },
              { user: { primaryOrganizationId: { in: managedOrganizationIds } } },
            ]
          : []),
      ],
    };
  }

  private activityScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.AdminAuditLogWhereInput {
    if (managedOrganizationIds === null) {
      return {};
    }

    return {
      OR: [
        { actorUserId: actor.userId },
        ...(managedOrganizationIds.length > 0
          ? [{ actorUser: { primaryOrganizationId: { in: managedOrganizationIds } } }]
          : []),
      ],
    };
  }

  private async logAudit(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
  ): Promise<void> {
    await prisma.adminAuditLog.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId,
        summary,
      },
    });
  }
}

export const adminService = new AdminService();
