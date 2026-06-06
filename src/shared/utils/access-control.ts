import { OrganizationKind, Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';

export interface AuthenticatedUserLike {
  userId: string;
  role: UserRole;
  organizationId?: string | null;
}

export interface CanvasAccessMetadata {
  canEdit: boolean;
  canDelete: boolean;
  canHostLiveSession: boolean;
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

export const getLinkedStudentIdsForParent = async (
  parentUserId: string,
): Promise<string[]> => {
  const links = await prisma.parentStudentLink.findMany({
    where: { parentUserId, status: 'ACTIVE' },
    select: { studentUserId: true },
  });
  return links.map((link) => link.studentUserId);
};

export const canvasReadWhere = async (
  user: AuthenticatedUserLike,
): Promise<Prisma.CanvasWhereInput> => {
  if (isSuperAdmin(user.role)) {
    return { deletedAt: null };
  }

  if (isAdminRole(user.role)) {
    const organizationIds = await getManagedOrganizationIds(user);
    return {
      deletedAt: null,
      ...(organizationIds && organizationIds.length > 0
        ? { organizationId: { in: organizationIds } }
        : { id: '__none__' }),
    };
  }

  if (user.role === UserRole.TEACHER) {
    return { deletedAt: null, userId: user.userId };
  }

  if (user.role === UserRole.STUDENT) {
    return {
      deletedAt: null,
      liveSessions: {
        some: {
          participants: { some: { userId: user.userId } },
        },
      },
    };
  }

  if (user.role === UserRole.PARENT) {
    const studentIds = await getLinkedStudentIdsForParent(user.userId);
    if (studentIds.length === 0) {
      return { id: '__none__' };
    }
    return {
      deletedAt: null,
      OR: [
        { userId: { in: studentIds } },
        {
          liveSessions: {
            some: {
              OR: [
                { participants: { some: { userId: { in: studentIds } } } },
                { invites: { some: { invitedUserId: { in: studentIds } } } },
              ],
            },
          },
        },
      ],
    };
  }

  return { id: '__none__' };
};

const canvasAccessWhere = async (
  canvasId: string,
  user: AuthenticatedUserLike,
): Promise<Prisma.CanvasWhereInput> => {
  return {
    AND: [
      { id: canvasId },
      await canvasReadWhere(user),
    ],
  };
};

const canvasWriteWhere = async (
  canvasId: string,
  user: AuthenticatedUserLike,
): Promise<Prisma.CanvasWhereInput> => {
  if (isSuperAdmin(user.role)) {
    return { id: canvasId, deletedAt: null };
  }

  if (isAdminRole(user.role)) {
    const organizationIds = await getManagedOrganizationIds(user);
    return {
      id: canvasId,
      deletedAt: null,
      ...(organizationIds && organizationIds.length > 0
        ? { organizationId: { in: organizationIds } }
        : { id: '__none__' }),
    };
  }

  return {
    id: canvasId,
    deletedAt: null,
    userId: user.userId,
  };
};

export const canvasAccessMetadata = async (
  canvas: { userId: string; organizationId?: string | null },
  user: AuthenticatedUserLike,
): Promise<CanvasAccessMetadata> => {
  if (isSuperAdmin(user.role)) {
    return { canEdit: true, canDelete: true, canHostLiveSession: true };
  }

  if (isAdminRole(user.role)) {
    const organizationIds = await getManagedOrganizationIds(user);
    const canManage =
      organizationIds === null ||
      (canvas.organizationId != null &&
        organizationIds.includes(canvas.organizationId));
    return {
      canEdit: canManage,
      canDelete: canManage,
      canHostLiveSession: canManage,
    };
  }

  const isOwner = user.role === UserRole.TEACHER && canvas.userId === user.userId;
  return {
    canEdit: isOwner,
    canDelete: isOwner,
    canHostLiveSession: isOwner,
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

export const ensureCanvasWriteAccess = async (
  canvasId: string,
  user: AuthenticatedUserLike,
) => {
  const canvas = await prisma.canvas.findFirst({
    where: await canvasWriteWhere(canvasId, user),
    include: {
      organization: true,
      slides: {
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!canvas) {
    throw new AppError('Only the board creator can edit this whiteboard', 403);
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
