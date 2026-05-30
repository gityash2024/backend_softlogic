import { OrganizationStatus, Prisma, UserRole } from '@prisma/client';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import {
  getManagedOrganizationIds,
  isSuperAdmin,
  type AuthenticatedUserLike,
} from '@/shared/utils/access-control';

type SettingsValue = Prisma.JsonObject;

export class OrganizationsService {
  async listAccessibleOrganizations(
    actor: AuthenticatedUserLike,
  ): Promise<Array<{ id: string; name: string }>> {
    if (isSuperAdmin(actor.role)) {
      return prisma.organization.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    }

    const managedIds = await getManagedOrganizationIds(actor);
    if (managedIds === null) {
      return prisma.organization.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    }

    let scopedIds = managedIds;
    if (scopedIds.length === 0) {
      scopedIds = actor.organizationId ? [actor.organizationId] : [];
    }

    return prisma.organization.findMany({
      where: { id: { in: scopedIds }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async loadOwnSettings(actor: AuthenticatedUserLike): Promise<{
    organizationId: string;
    organizationName: string;
    settings: SettingsValue;
  }> {
    if (!actor.organizationId) {
      throw new AppError('Organization assignment is required', 403);
    }
    return this.loadSettings(actor, actor.organizationId);
  }

  async loadSettings(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ): Promise<{
    organizationId: string;
    organizationName: string;
    settings: SettingsValue;
  }> {
    await this.assertVisibility(actor, organizationId);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, settings: true, status: true, deletedAt: true },
    });
    if (!organization || organization.deletedAt || organization.status !== OrganizationStatus.ACTIVE) {
      throw new AppError('Organization not found', 404);
    }
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      settings: (organization.settings ?? {}) as SettingsValue,
    };
  }

  async updateSettings(
    actor: AuthenticatedUserLike,
    organizationId: string,
    settings: Record<string, unknown>,
  ): Promise<{
    organizationId: string;
    organizationName: string;
    settings: SettingsValue;
  }> {
    await this.assertCanEdit(actor, organizationId);
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        settings: settings as Prisma.InputJsonValue,
      },
      select: { id: true, name: true, settings: true },
    });
    await prisma.adminAuditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'organization.settings.update',
        targetType: 'organization',
        targetId: organizationId,
        summary: 'Updated organization settings',
      },
    });
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      settings: (organization.settings ?? {}) as SettingsValue,
    };
  }

  private async assertVisibility(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ): Promise<void> {
    if (actor.role === UserRole.SUPER_ADMIN) return;
    if (actor.organizationId === organizationId) return;
    throw new AppError('You do not have access to this organization', 403);
  }

  private async assertCanEdit(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ): Promise<void> {
    if (actor.role === UserRole.SUPER_ADMIN) return;
    if (
      (actor.role === UserRole.PARTNER_ADMIN ||
        actor.role === UserRole.CUSTOMER_ADMIN ||
        actor.role === UserRole.ADMIN) &&
      actor.organizationId === organizationId
    ) {
      return;
    }
    throw new AppError('Only organization admins can update these settings', 403);
  }
}

export const organizationsService = new OrganizationsService();
