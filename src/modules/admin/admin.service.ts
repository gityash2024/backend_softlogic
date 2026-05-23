import {
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

  async listOrganizations(actor: AuthenticatedUserLike) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);

    const where =
      managedOrganizationIds === null
        ? {}
        : { id: { in: managedOrganizationIds } };

    return prisma.organization.findMany({
      where,
      orderBy: { name: 'asc' },
      include: this.organizationInclude,
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

  async listUsers(actor: AuthenticatedUserLike) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const where: Prisma.UserWhereInput =
      managedOrganizationIds === null
        ? { deletedAt: null }
        : {
            deletedAt: null,
            OR: [
              { id: actor.userId },
              { primaryOrganizationId: { in: managedOrganizationIds } },
            ],
          };

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        primaryOrganization: true,
      },
    });

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

    return usersWithSubscription;
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

  async listSubscriptions(actor: AuthenticatedUserLike) {
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const where: Prisma.SubscriptionWhereInput =
      managedOrganizationIds === null
        ? {}
        : {
            OR: [
              { organizationId: { in: managedOrganizationIds } },
              { user: { primaryOrganizationId: { in: managedOrganizationIds } } },
            ],
          };

    return prisma.subscription.findMany({
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
      orderBy: { updatedAt: 'desc' },
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

  async listActivity(actor: AuthenticatedUserLike) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new AppError('Only super admin can view audit activity', 403);
    }

    return prisma.adminAuditLog.findMany({
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
      take: 100,
    });
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
