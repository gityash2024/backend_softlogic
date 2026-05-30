import { OrganizationKind, Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';

export interface AuthenticatedUserLike {
  userId: string;
  role: UserRole;
  organizationId?: string | null;
}

export const isSuperAdmin = (role: UserRole): boolean => role === 'SUPER_ADMIN';

export const isAdminRole = (role: UserRole): boolean =>
  ['SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'].includes(role);

export const canManageRole = (
  actorRole: UserRole,
  targetRole: UserRole,
): boolean => {
  if (actorRole === 'SUPER_ADMIN') {
    return true;
  }

  if (actorRole === 'PARTNER_ADMIN') {
    return ['CUSTOMER_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'].includes(targetRole);
  }

  if (actorRole === 'CUSTOMER_ADMIN' || actorRole === 'ADMIN') {
    return ['TEACHER', 'STUDENT', 'PARENT'].includes(targetRole);
  }

  return false;
};

export const getMembershipOrganizationIds = async (
  userId: string,
): Promise<string[]> => {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  return memberships.map((membership) => membership.organizationId);
};

export const getAccessibleOrganizationIds = async (
  user: AuthenticatedUserLike,
): Promise<string[] | null> => {
  if (isSuperAdmin(user.role)) {
    return null;
  }

  return getMembershipOrganizationIds(user.userId);
};

export const getManagedOrganizationIds = async (
  user: AuthenticatedUserLike,
): Promise<string[] | null> => {
  if (isSuperAdmin(user.role)) {
    return null;
  }

  const membershipOrganizationIds = await getMembershipOrganizationIds(user.userId);
  if (user.role === 'PARTNER_ADMIN') {
    const managedIds = new Set(membershipOrganizationIds);
    let frontier = membershipOrganizationIds;

    while (frontier.length > 0) {
      const children = await prisma.organization.findMany({
        where: {
          parentOrganizationId: { in: frontier },
          kind: { in: [OrganizationKind.PARTNER, OrganizationKind.CUSTOMER] },
          deletedAt: null,
        },
        select: { id: true },
      });
      frontier = children
        .map((organization) => organization.id)
        .filter((id) => !managedIds.has(id));
      frontier.forEach((id) => managedIds.add(id));
    }

    return Array.from(managedIds);
  }

  if (user.role === 'CUSTOMER_ADMIN' || user.role === 'ADMIN') {
    return membershipOrganizationIds;
  }

  return [];
};

const canvasAccessWhere = async (
  canvasId: string,
  user: AuthenticatedUserLike,
): Promise<Prisma.CanvasWhereInput> => {
  if (isSuperAdmin(user.role)) {
    return { id: canvasId, deletedAt: null };
  }

  const organizationIds = await getAccessibleOrganizationIds(user);

  return {
    id: canvasId,
    deletedAt: null,
    OR: [
      { userId: user.userId },
      ...(organizationIds && organizationIds.length > 0
        ? [{ organizationId: { in: organizationIds } }]
        : []),
    ],
  };
};

export const ensureCanvasAccess = async (
  canvasId: string,
  user: AuthenticatedUserLike,
) => {
  const canvas = await prisma.canvas.findFirst({
    where: await canvasAccessWhere(canvasId, user),
    include: {
      organization: true,
      slides: {
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!canvas) {
    throw new AppError('Canvas not found', 404);
  }

  return canvas;
};

export const ensureOrganizationManaged = async (
  organizationId: string,
  user: AuthenticatedUserLike,
) => {
  if (isSuperAdmin(user.role)) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new AppError('Organization not found', 404);
    }
    return organization;
  }

  const managedOrganizationIds = await getManagedOrganizationIds(user);
  if (!managedOrganizationIds?.includes(organizationId)) {
    throw new AppError('You do not have access to this organization', 403);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!organization || organization.deletedAt) {
    throw new AppError('Organization not found', 404);
  }
  return organization;
};
