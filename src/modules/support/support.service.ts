import {
  Prisma,
  SupportCategory,
  SupportEventType,
  SupportPriority,
  SupportThreadStatus,
  UserRole,
} from '@prisma/client';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import {
  AuthenticatedUserLike,
  getMembershipOrganizationIds,
  isSuperAdmin,
} from '@/shared/utils/access-control';

import {
  ApplyActionInput,
  CreateThreadInput,
  ListThreadsQuery,
  SetPriorityInput,
  UpdateStatusInput,
} from './support.validator';

type DbClient = typeof prisma | Prisma.TransactionClient;

const ORG_ADMIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.CUSTOMER_ADMIN,
  UserRole.ADMIN,
];

const threadInclude = {
  organization: { select: { id: true, name: true, slug: true, status: true } },
  openedBy: { select: { id: true, name: true, email: true, role: true } },
  resolvedBy: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.SupportThreadInclude;

const threadDetailInclude = {
  ...threadInclude,
  messages: {
    include: { author: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  events: {
    include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SupportThreadInclude;

export class SupportService {
  async resolveActorOrgId(actor: AuthenticatedUserLike): Promise<string | null> {
    if (actor.organizationId) return actor.organizationId;
    const ids = await getMembershipOrganizationIds(actor.userId);
    return ids[0] ?? null;
  }

  async assertCanViewOrg(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ): Promise<void> {
    if (isSuperAdmin(actor.role)) return;
    const ids = await getMembershipOrganizationIds(actor.userId);
    if (!ids.includes(organizationId)) {
      throw new AppError('You do not have access to this organization', 403);
    }
  }

  async assertCanOpenSupport(actor: AuthenticatedUserLike): Promise<void> {
    if (!ORG_ADMIN_ROLES.includes(actor.role)) {
      throw new AppError('Only admins can open support threads', 403);
    }
  }

  async listThreads(actor: AuthenticatedUserLike, query: ListThreadsQuery) {
    const where: Prisma.SupportThreadWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.priority) where.priority = query.priority;
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { messages: { some: { body: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }

    if (isSuperAdmin(actor.role)) {
      if (query.organizationId) where.organizationId = query.organizationId;
    } else {
      const ids = await getMembershipOrganizationIds(actor.userId);
      if (ids.length === 0) {
        return this.emptyPage(query);
      }
      where.organizationId = { in: ids };
    }

    const [total, items] = await Promise.all([
      prisma.supportThread.count({ where }),
      prisma.supportThread.findMany({
        where,
        include: threadInclude,
        orderBy: [{ lastActivityAt: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.perPage));
    return {
      items,
      total,
      page: query.page,
      perPage: query.perPage,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1,
      filters: {
        status: query.status ?? null,
        category: query.category ?? null,
        priority: query.priority ?? null,
        organizationId: query.organizationId ?? null,
        search: query.search ?? null,
      },
    };
  }

  async getUnreadCount(actor: AuthenticatedUserLike): Promise<{ count: number }> {
    const where: Prisma.SupportThreadWhereInput = {
      status: { not: 'CLOSED' },
    };

    if (isSuperAdmin(actor.role)) {
      // Super admin "unseen": threads where the latest message author is NOT a super admin.
      const threads = await prisma.supportThread.findMany({
        where,
        select: {
          id: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { author: { select: { role: true } } },
          },
        },
      });
      const count = threads.filter((thread) => {
        const lastAuthorRole = thread.messages[0]?.author.role;
        return lastAuthorRole !== UserRole.SUPER_ADMIN;
      }).length;
      return { count };
    }

    const orgIds = await getMembershipOrganizationIds(actor.userId);
    if (orgIds.length === 0) return { count: 0 };
    where.organizationId = { in: orgIds };

    const threads = await prisma.supportThread.findMany({
      where,
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { authorUserId: true },
        },
      },
    });
    const count = threads.filter((thread) => {
      const lastAuthorId = thread.messages[0]?.authorUserId;
      return lastAuthorId !== undefined && lastAuthorId !== actor.userId;
    }).length;
    return { count };
  }

  async getThread(actor: AuthenticatedUserLike, threadId: string) {
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      include: threadDetailInclude,
    });
    if (!thread) throw new AppError('Support thread not found', 404);
    await this.assertCanViewOrg(actor, thread.organizationId);
    return thread;
  }

  async createThread(actor: AuthenticatedUserLike, input: CreateThreadInput) {
    await this.assertCanOpenSupport(actor);
    let organizationId = input.organizationId ?? null;
    if (!organizationId) {
      organizationId = await this.resolveActorOrgId(actor);
    }
    if (!organizationId) {
      throw new AppError('Organization is required for support threads', 400);
    }
    if (!isSuperAdmin(actor.role)) {
      await this.assertCanViewOrg(actor, organizationId);
    }

    const created = await prisma.$transaction(async (tx) => {
      const thread = await tx.supportThread.create({
        data: {
          organizationId,
          openedByUserId: actor.userId,
          category: input.category,
          subject: input.subject,
          priority: input.priority ?? SupportPriority.NORMAL,
          requestedAction:
            input.requestedAction === undefined || input.requestedAction === null
              ? Prisma.JsonNull
              : (input.requestedAction as unknown as Prisma.InputJsonValue),
          lastActivityAt: new Date(),
        },
      });
      await tx.supportMessage.create({
        data: {
          threadId: thread.id,
          authorUserId: actor.userId,
          body: input.body,
        },
      });
      return thread;
    });

    void this.notifyThreadOpened(created.id).catch((error) => {
      console.error('[support] notifyThreadOpened failed', error);
    });

    return this.getThread(actor, created.id);
  }

  async addMessage(actor: AuthenticatedUserLike, threadId: string, body: string) {
    const thread = await this.getThread(actor, threadId);
    if (thread.status === SupportThreadStatus.CLOSED) {
      throw new AppError('Cannot reply to a closed thread', 409);
    }
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: { threadId, authorUserId: actor.userId, body },
      });
      await tx.supportThread.update({
        where: { id: threadId },
        data: {
          lastActivityAt: new Date(),
          status:
            thread.status === SupportThreadStatus.OPEN && isSuperAdmin(actor.role)
              ? SupportThreadStatus.IN_PROGRESS
              : thread.status,
        },
      });
      await tx.supportThreadEvent.create({
        data: {
          threadId,
          actorUserId: actor.userId,
          type: SupportEventType.REPLIED,
          payload: { messageId: created.id } as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    void this.notifyReply(threadId, actor.userId, message.id).catch((error) => {
      console.error('[support] notifyReply failed', error);
    });

    return this.getThread(actor, threadId);
  }

  async updateStatus(
    actor: AuthenticatedUserLike,
    threadId: string,
    input: UpdateStatusInput,
  ) {
    const thread = await this.getThread(actor, threadId);
    const next = input.status;
    if (
      (next === SupportThreadStatus.RESOLVED || next === SupportThreadStatus.IN_PROGRESS) &&
      !isSuperAdmin(actor.role)
    ) {
      throw new AppError('Only super admin can mark threads as in progress or resolved', 403);
    }
    if (next === SupportThreadStatus.CLOSED && !isSuperAdmin(actor.role)) {
      const isOpener = thread.openedByUserId === actor.userId;
      if (!isOpener) {
        throw new AppError('Only the opener or super admin can close a thread', 403);
      }
    }

    const data: Prisma.SupportThreadUpdateInput = {
      status: next,
      lastActivityAt: new Date(),
    };
    if (next === SupportThreadStatus.RESOLVED) {
      data.resolvedBy = { connect: { id: actor.userId } };
      data.resolvedAt = new Date();
    }
    if (next === SupportThreadStatus.CLOSED) {
      data.closedAt = new Date();
    }

    await prisma.$transaction(async (tx) => {
      await tx.supportThread.update({ where: { id: threadId }, data });
      await tx.supportThreadEvent.create({
        data: {
          threadId,
          actorUserId: actor.userId,
          type: SupportEventType.STATUS_CHANGE,
          payload: { from: thread.status, to: next } as Prisma.InputJsonValue,
        },
      });
    });

    void this.notifyStatusChange(threadId, actor.userId, thread.status, next).catch(
      (error) => {
        console.error('[support] notifyStatusChange failed', error);
      },
    );

    return this.getThread(actor, threadId);
  }

  async setPriority(
    actor: AuthenticatedUserLike,
    threadId: string,
    input: SetPriorityInput,
  ) {
    if (!isSuperAdmin(actor.role)) {
      throw new AppError('Only super admin can change priority', 403);
    }
    const thread = await this.getThread(actor, threadId);
    if (thread.priority === input.priority) return thread;
    await prisma.$transaction(async (tx) => {
      await tx.supportThread.update({
        where: { id: threadId },
        data: { priority: input.priority, lastActivityAt: new Date() },
      });
      await tx.supportThreadEvent.create({
        data: {
          threadId,
          actorUserId: actor.userId,
          type: SupportEventType.PRIORITY_CHANGE,
          payload: { from: thread.priority, to: input.priority } as Prisma.InputJsonValue,
        },
      });
    });
    return this.getThread(actor, threadId);
  }

  async applyAction(
    actor: AuthenticatedUserLike,
    threadId: string,
    input: ApplyActionInput,
  ) {
    if (!isSuperAdmin(actor.role)) {
      throw new AppError('Only super admin can apply actions', 403);
    }
    const thread = await this.getThread(actor, threadId);
    const { adminService } = await import('@/modules/admin/admin.service');

    let result: Record<string, unknown> = {};

    switch (input.kind) {
      case 'seats_increase':
      case 'seats_decrease': {
        const to = Number((input.params as { to?: unknown }).to);
        if (!Number.isFinite(to) || to < 1) {
          throw new AppError('Invalid seat target', 400);
        }
        const subscription = await this.requireActiveSubscription(thread.organizationId);
        const updated = await adminService.updateSubscription(actor, subscription.id, {
          seatLimit: to,
        });
        result = { subscriptionId: updated.id, seatLimit: updated.seatLimit };
        break;
      }
      case 'subscription_extend': {
        const dateRaw = (input.params as { newEndDate?: unknown }).newEndDate;
        const newEndDate = dateRaw ? new Date(String(dateRaw)) : null;
        if (!newEndDate || Number.isNaN(newEndDate.getTime())) {
          throw new AppError('Invalid newEndDate', 400);
        }
        const subscription = await this.requireActiveSubscription(thread.organizationId);
        const updated = await adminService.updateSubscription(actor, subscription.id, {
          endDate: newEndDate,
        });
        result = { subscriptionId: updated.id, endDate: updated.endDate };
        break;
      }
      case 'reset_device': {
        const activationId = String((input.params as { activationId?: unknown }).activationId ?? '');
        if (!activationId) throw new AppError('Invalid activationId', 400);
        const updated = await adminService.resetHardwareActivation(actor, activationId);
        result = { activationId: updated.id, status: updated.status };
        break;
      }
      case 'disable_org':
      case 'enable_org': {
        const nextStatus = input.kind === 'enable_org' ? 'ACTIVE' : 'INACTIVE';
        const updated = await adminService.updateOrganization(actor, thread.organizationId, {
          status: nextStatus as 'ACTIVE' | 'INACTIVE',
        } as Parameters<typeof adminService.updateOrganization>[2]);
        result = { organizationId: updated.id, status: updated.status };
        break;
      }
      case 'extend_key_expiry': {
        const params = input.params as { activationKeyId?: unknown; newExpiresAt?: unknown };
        const activationKeyId = String(params.activationKeyId ?? '');
        const rawDate = params.newExpiresAt;
        if (!activationKeyId) throw new AppError('Invalid activationKeyId', 400);
        const newExpiresAt = rawDate ? new Date(String(rawDate)) : null;
        if (newExpiresAt && Number.isNaN(newExpiresAt.getTime())) {
          throw new AppError('Invalid newExpiresAt', 400);
        }
        const updated = await prisma.hardwareActivationKey.update({
          where: { id: activationKeyId },
          data: { expiresAt: newExpiresAt },
        });
        await prisma.adminAuditLog.create({
          data: {
            actorUserId: actor.userId,
            action: 'hardware.activation_key.extend_expiry',
            targetType: 'hardware_activation_key',
            targetId: updated.id,
            summary: `Extended expiry${newExpiresAt ? ` to ${newExpiresAt.toISOString()}` : ' (cleared)'}`,
          },
        });
        result = { activationKeyId: updated.id, expiresAt: updated.expiresAt };
        break;
      }
      default:
        throw new AppError(`Unsupported action ${input.kind}`, 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.supportThreadEvent.create({
        data: {
          threadId,
          actorUserId: actor.userId,
          type: SupportEventType.ACTION_APPLIED,
          payload: { kind: input.kind, params: input.params, result } as Prisma.InputJsonValue,
        },
      });
      await tx.supportMessage.create({
        data: {
          threadId,
          authorUserId: actor.userId,
          body: this.actionAutoMessage(input.kind, result),
        },
      });
      await tx.supportThread.update({
        where: { id: threadId },
        data: {
          lastActivityAt: new Date(),
          status: input.autoResolve ? SupportThreadStatus.RESOLVED : SupportThreadStatus.IN_PROGRESS,
          resolvedAt: input.autoResolve ? new Date() : null,
          resolvedByUserId: input.autoResolve ? actor.userId : null,
        },
      });
    });

    if (input.autoResolve) {
      void this.notifyStatusChange(
        threadId,
        actor.userId,
        thread.status,
        SupportThreadStatus.RESOLVED,
      ).catch((error) => {
        console.error('[support] notifyStatusChange failed', error);
      });
    }

    return this.getThread(actor, threadId);
  }

  private actionAutoMessage(
    kind: ApplyActionInput['kind'],
    result: Record<string, unknown>,
  ): string {
    switch (kind) {
      case 'seats_increase':
      case 'seats_decrease':
        return `Updated seat limit to ${result.seatLimit ?? 'n/a'}.`;
      case 'subscription_extend':
        return `Extended subscription end date to ${result.endDate ?? 'n/a'}.`;
      case 'reset_device':
        return 'Reset the bound device — the activation key is available to re-bind.';
      case 'disable_org':
        return 'Organization marked INACTIVE.';
      case 'enable_org':
        return 'Organization marked ACTIVE.';
      case 'extend_key_expiry':
        return `Activation key expiry updated to ${result.expiresAt ?? 'no expiry'}.`;
      default:
        return 'Action applied.';
    }
  }

  private emptyPage(query: ListThreadsQuery) {
    return {
      items: [],
      total: 0,
      page: query.page,
      perPage: query.perPage,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
      filters: {
        status: query.status ?? null,
        category: query.category ?? null,
        priority: query.priority ?? null,
        organizationId: query.organizationId ?? null,
        search: query.search ?? null,
      },
    };
  }

  private async requireActiveSubscription(organizationId: string, db: DbClient = prisma) {
    const subscription = await db.subscription.findFirst({
      where: {
        organizationId,
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!subscription) {
      throw new AppError('No active subscription found for this organization', 404);
    }
    return subscription;
  }

  private async notifyThreadOpened(threadId: string) {
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      include: {
        organization: { select: { name: true } },
        openedBy: { select: { name: true, email: true } },
      },
    });
    if (!thread) return;
    const superAdmins = await prisma.user.findMany({
      where: { role: UserRole.SUPER_ADMIN, deletedAt: null },
      select: { email: true },
    });
    if (superAdmins.length === 0) return;
    const { sendSupportThreadCreatedEmail } = await import('@/shared/utils/email');
    await Promise.all(
      superAdmins.map((sa) =>
        sendSupportThreadCreatedEmail({
          to: sa.email,
          organizationName: thread.organization.name,
          threadId: thread.id,
          category: thread.category,
          subject: thread.subject,
          openedByName: thread.openedBy.name ?? thread.openedBy.email,
        }).catch(() => {}),
      ),
    );
  }

  private async notifyReply(threadId: string, actorUserId: string, messageId: string) {
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      include: {
        organization: { select: { name: true } },
        openedBy: { select: { name: true, email: true } },
      },
    });
    const message = await prisma.supportMessage.findUnique({
      where: { id: messageId },
      include: { author: { select: { name: true, email: true, role: true } } },
    });
    if (!thread || !message) return;

    const { sendSupportReplyEmail } = await import('@/shared/utils/email');
    const replyExcerpt = message.body.slice(0, 280);
    const replyAuthorName = message.author.name ?? message.author.email;

    if (actorUserId === thread.openedByUserId) {
      const superAdmins = await prisma.user.findMany({
        where: { role: UserRole.SUPER_ADMIN, deletedAt: null },
        select: { email: true },
      });
      await Promise.all(
        superAdmins.map((sa) =>
          sendSupportReplyEmail({
            to: sa.email,
            organizationName: thread.organization.name,
            threadId: thread.id,
            subject: thread.subject,
            replyAuthorName,
            replyExcerpt,
            audience: 'super_admin',
          }).catch(() => {}),
        ),
      );
    } else {
      if (!thread.openedBy.email) return;
      await sendSupportReplyEmail({
        to: thread.openedBy.email,
        organizationName: thread.organization.name,
        threadId: thread.id,
        subject: thread.subject,
        replyAuthorName,
        replyExcerpt,
        audience: 'org_admin',
      }).catch(() => {});
    }
  }

  private async notifyStatusChange(
    threadId: string,
    actorUserId: string,
    from: SupportThreadStatus,
    to: SupportThreadStatus,
  ) {
    if (from === to) return;
    if (to !== SupportThreadStatus.RESOLVED && to !== SupportThreadStatus.CLOSED) return;
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      include: {
        organization: { select: { name: true } },
        openedBy: { select: { name: true, email: true } },
      },
    });
    if (!thread || !thread.openedBy.email) return;
    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { name: true, email: true },
    });
    const changedByName = actor?.name ?? actor?.email ?? 'A team member';
    const { sendSupportStatusChangeEmail } = await import('@/shared/utils/email');
    await sendSupportStatusChangeEmail({
      to: thread.openedBy.email,
      organizationName: thread.organization.name,
      threadId: thread.id,
      subject: thread.subject,
      newStatus: to,
      changedByName,
    }).catch(() => {});
  }
}

export const supportService = new SupportService();

export type { SupportCategory, SupportThreadStatus, SupportPriority, SupportEventType };
