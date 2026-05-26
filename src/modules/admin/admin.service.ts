import {
  ExportFormat,
  ExportStatus,
  LiveSessionStatus,
  OrganizationKind,
  OrganizationStatus,
  Prisma,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { prisma } from '@/config';
import {
  AuthenticatedUserLike,
  canManageRole,
  ensureOrganizationManaged,
  getManagedOrganizationIds,
} from '@/shared/utils/access-control';
import { AppError } from '@/shared/errors/AppError';
import { findUserContextById } from '@/modules/users/user-context.service';
import { deleteImageAsset, uploadImageBuffer } from '@/shared/services/cloudinary.service';
import { sendWelcomeEmail } from '@/shared/utils/email';
import { buildAdminExport, type AdminExportFormat } from './admin-export.util';
import type {
  ListActivityQuery,
  ListContentCanvasesQuery,
  ListContentExportsQuery,
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
}

interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  status?: OrganizationStatus;
  settings?: Record<string, unknown>;
}

interface CreateUserInput {
  email: string;
  name?: string;
  role: UserRole;
  status?: UserStatus;
  organizationId?: string | null;
  timezone?: string;
  language?: string;
}

interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  status?: UserStatus;
  organizationId?: string | null;
  timezone?: string;
  language?: string;
}

interface CreateSubscriptionInput {
  organizationId?: string | null;
  userId?: string | null;
  planName: string;
  status?: SubscriptionStatus;
  seatLimit: number;
  seatUsage: number;
  startDate: Date;
  endDate?: Date | null;
}

interface UpdateSubscriptionInput {
  planName?: string;
  status?: SubscriptionStatus;
  seatLimit?: number;
  seatUsage?: number;
  startDate?: Date;
  endDate?: Date | null;
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

const DAY_MS = 24 * 60 * 60 * 1000;

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `org-${Date.now()}`;

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
    const and: Prisma.OrganizationWhereInput[] = [
      this.organizationScopeWhere(managedOrganizationIds),
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
    if (!organization) throw new AppError('Organization not found', 404);
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
        { header: 'Status', key: 'status', width: 16, value: (row) => ORGANIZATION_STATUS_LABEL[row.status] },
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

    const organization = await prisma.organization.create({
      data: {
        name: input.name,
        slug: input.slug ? slugify(input.slug) : slugify(input.name),
        kind,
        parentOrganizationId,
      },
      include: this.organizationInclude,
    });

    await this.logAudit(actor.userId, 'organization.create', 'organization', organization.id, `Created organization ${organization.name}`);
    return organization;
  }

  async updateOrganization(
    actor: AuthenticatedUserLike,
    organizationId: string,
    input: UpdateOrganizationInput,
  ) {
    await ensureOrganizationManaged(organizationId, actor);

    const existing = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, settings: true },
    });
    if (!existing) {
      throw new AppError('Organization not found', 404);
    }

    const data: Prisma.OrganizationUpdateInput = {
      name: input.name,
      slug: input.slug ? slugify(input.slug) : undefined,
      status: input.status,
    };
    if (input.settings !== undefined) {
      data.settings = mergeOrganizationSettings(
        existing.settings,
        input.settings,
      );
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data,
      include: this.organizationInclude,
    });

    await this.logAudit(
      actor.userId,
      'organization.update',
      'organization',
      organization.id,
      `Updated organization ${organization.name}`,
    );
    return organization;
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
    const and: Prisma.UserWhereInput[] = [
      this.userScopeWhere(actor, managedOrganizationIds),
    ];
    const roles = csvEnumValues(query.role, [
      UserRole.SUPER_ADMIN,
      UserRole.PARTNER_ADMIN,
      UserRole.CUSTOMER_ADMIN,
      UserRole.ADMIN,
      UserRole.TEACHER,
      UserRole.STUDENT,
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
    const result = await this.listUsers(
      actor,
      { page: 1, perPage: 1, sortOrder: 'desc', search: undefined } as ListUsersQuery,
      { exportAll: true },
    );
    const user = result.items.find((item) => item.id === userId);
    if (!user) throw new AppError('User not found', 404);
    return user;
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
        { header: 'Status', key: 'status', width: 16, value: (row) => USER_STATUS_LABEL[row.status] },
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

    const organizationId = await this.resolveOrganizationForUser(actor, input.organizationId ?? null);
    const existing = await prisma.user.findFirst({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('A user with this email already exists', 409);
    }

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: input.email,
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

      return createdUser;
    });

    await this.logAudit(actor.userId, 'user.create', 'user', user.id, `Created user ${user.email}`);
    await sendWelcomeEmail({
      to: user.email,
      name: user.name,
      role: user.role,
    });
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
    });

    await this.logAudit(actor.userId, 'user.update', 'user', userId, `Updated user ${existing.email}`);
    return findUserContextById(userId);
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
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELED,
    ]);
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
    if (statuses) and.push({ status: { in: statuses } });
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
        { header: 'Seat Usage', key: 'seatUsage', width: 14, value: (row) => row.seatUsage },
        { header: 'Seat Limit', key: 'seatLimit', width: 14, value: (row) => row.seatLimit },
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
      if (targetUser.primaryOrganizationId) {
        await ensureOrganizationManaged(targetUser.primaryOrganizationId, actor);
      }
    }

    const subscription = await prisma.subscription.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        planName: input.planName,
        status: input.status ?? SubscriptionStatus.ACTIVE,
        seatLimit: input.seatLimit,
        seatUsage: input.seatUsage,
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

    await this.logAudit(actor.userId, 'subscription.create', 'subscription', subscription.id, `Created subscription ${subscription.planName}`);
    return subscription;
  }

  async updateSubscription(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ) {
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

    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: input,
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

    await this.logAudit(actor.userId, 'subscription.update', 'subscription', subscription.id, `Updated subscription ${subscription.planName}`);
    return subscription;
  }

  async listActivity(
    actor: AuthenticatedUserLike,
    query: ListActivityQuery,
    options: { exportAll?: boolean } = {},
  ) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new AppError('Only super admin can view audit activity', 403);
    }

    const and: Prisma.AdminAuditLogWhereInput[] = [];
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
    const where: Prisma.AdminAuditLogWhereInput = and.length ? { AND: and } : {};
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
        { header: 'File Size', key: 'fileSize', width: 14, value: (row) => row.fileSize ?? 0 },
        { header: 'File URL', key: 'fileUrl', width: 50, value: (row) => row.fileUrl ?? '' },
        { header: 'Error', key: 'error', width: 50, value: (row) => row.error ?? '' },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
        { header: 'Completed At', key: 'completedAt', width: 22, value: (row) => row.completedAt },
      ],
    });
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

  private userScopeWhere(
    actor: AuthenticatedUserLike,
    managedOrganizationIds: string[] | null,
  ): Prisma.UserWhereInput {
    if (managedOrganizationIds === null) {
      return { deletedAt: null };
    }

    return {
      deletedAt: null,
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
  ): Prisma.OrganizationWhereInput {
    return managedOrganizationIds === null ? {} : { id: { in: managedOrganizationIds } };
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
