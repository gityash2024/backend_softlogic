import {
  AiCreditAccountStatus,
  AiCreditLedgerType,
  AiCreditScope,
  HardwareActivationStatus,
  HardwareActivationKeyStatus,
  OrganizationStatus,
  PaymentProvider,
  PaymentProviderConfig,
  PaymentProviderMode,
  PaymentTransactionStatus,
  Prisma,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import type { AuthenticatedUserLike } from '@/shared/utils/access-control';
import { ensureOrganizationManaged } from '@/shared/utils/access-control';
import { encryptSecret, tryDecryptSecret } from '@/shared/utils/cipher';
import {
  sendSeatUsageWarningEmail,
  sendSubscriptionExpiryEmail,
} from '@/shared/utils/email';
import {
  buildAdminExport,
  type AdminExportFormat,
} from '@/modules/admin/admin-export.util';

type DbClient = typeof prisma | Prisma.TransactionClient;

const hashSecret = (value: string): string =>
  createHash('sha256').update(value.trim()).digest('hex');

const isActiveSubscriptionStatus = (status: SubscriptionStatus): boolean =>
  status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIAL;

const DAY_MS = 24 * 60 * 60 * 1000;

// Seat-usage warning tiers (percentages). Highest crossed tier wins.
const SEAT_ALERT_TIERS = [90, 95, 100] as const;

// Subscription expiry reminder tiers (days remaining). Smaller (closer) tier wins.
const EXPIRY_REMINDER_TIERS = [30, 14, 7, 0] as const;

// Highest seat-usage tier that the given percentage has crossed, or null if below the lowest tier.
const highestSeatTierCrossed = (pct: number): number | null => {
  let crossed: number | null = null;
  for (const tier of SEAT_ALERT_TIERS) {
    if (pct >= tier) crossed = tier;
  }
  return crossed;
};

// Smallest expiry-reminder tier (days) that daysLeft has reached, or null if still further out.
const currentExpiryTier = (daysLeft: number): number | null => {
  let tier: number | null = null;
  for (const candidate of EXPIRY_REMINDER_TIERS) {
    if (daysLeft <= candidate) tier = candidate;
  }
  return tier;
};

// Whole days from now until the given date (can be negative when already past).
const daysUntil = (date: Date, now: Date = new Date()): number =>
  Math.ceil((date.getTime() - now.getTime()) / DAY_MS);

export interface SeatSnapshot {
  total: number;
  used: number;
  remaining: number;
}

export interface DeviceMetaInput {
  platform?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  [key: string]: unknown;
}

export interface VerifyHardwareActivationResult {
  valid: boolean;
  reason?:
    | 'invalid_key'
    | 'expired'
    | 'disabled'
    | 'inactive_activation'
    | 'bound_to_other_device'
    | 'not_bound'
    | 'subscription_inactive'
    | 'organization_inactive'
    | 'organization_mismatch';
  organizationId?: string;
  organizationName?: string;
  subscriptionId?: string;
  expiresAt?: Date | null;
  boundDeviceMeta?: Record<string, unknown> | null;
  lastVerifiedAt?: Date | null;
}

export class LicensingService {
  isLicensedRole(role: UserRole): boolean {
    return (
      role === UserRole.TEACHER ||
      role === UserRole.STUDENT ||
      role === UserRole.PARENT
    );
  }

  async getActiveOrganizationSubscription(
    organizationId: string,
    db: DbClient = prisma,
  ) {
    const subscriptions = await db.subscription.findMany({
      where: {
        organizationId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 1,
    });
    return subscriptions[0] ?? null;
  }

  async recalculateLicenseUsage(
    organizationId: string,
    db: DbClient = prisma,
  ): Promise<SeatSnapshot | null> {
    const subscription = await this.getActiveOrganizationSubscription(organizationId, db);
    if (!subscription) return null;

    const used = await db.user.count({
      where: {
        primaryOrganizationId: organizationId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        role: {
          in: [UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT],
        },
      },
    });

    await db.subscription.update({
      where: { id: subscription.id },
      data: { seatUsage: used },
    });

    await this.maybeSendSeatUsageWarning(
      {
        id: subscription.id,
        organizationId: subscription.organizationId ?? organizationId,
        seatLimit: subscription.seatLimit,
        seatAlertTier: subscription.seatAlertTier,
      },
      used,
      db,
    );

    return this.poolSnapshot(subscription.seatLimit, used);
  }

  /**
   * #5 Seat-usage warnings. Computes the current usage percentage, determines the highest
   * crossed tier among [90,95,100], and emails the organization's customer admins when a new,
   * higher tier is crossed (deduped via `seatAlertTier`). When usage drops below the lowest
   * tier, the stored alert tier is reset so future climbs re-alert. Never throws.
   */
  private async maybeSendSeatUsageWarning(
    subscription: {
      id: string;
      organizationId: string | null;
      seatLimit: number;
      seatAlertTier: number | null;
    },
    used: number,
    db: DbClient = prisma,
  ): Promise<void> {
    try {
      if (!subscription.organizationId) return;
      const pct =
        subscription.seatLimit > 0
          ? Math.round((100 * used) / subscription.seatLimit)
          : 0;
      const crossed = highestSeatTierCrossed(pct);
      const stored = subscription.seatAlertTier ?? null;

      // Usage dropped below the lowest tier — reset so future climbs re-alert.
      if (crossed === null) {
        if (stored !== null) {
          await db.subscription.update({
            where: { id: subscription.id },
            data: { seatAlertTier: null },
          });
        }
        return;
      }

      // Only alert when a strictly higher tier than previously emailed is crossed.
      if (stored !== null && crossed <= stored) return;

      const organization = await db.organization.findUnique({
        where: { id: subscription.organizationId },
        select: { id: true, name: true },
      });
      if (organization) {
        const recipients = await this.getOrganizationAdminRecipients(
          subscription.organizationId,
          db,
        );
        for (const recipient of recipients) {
          await sendSeatUsageWarningEmail({
            to: recipient.email,
            orgName: organization.name,
            seatUsage: used,
            seatLimit: subscription.seatLimit,
            pct,
            adminName: recipient.name,
          });
        }
      }

      await db.subscription.update({
        where: { id: subscription.id },
        data: { seatAlertTier: crossed },
      });
    } catch (error) {
      console.error('Seat usage warning failed:', error);
    }
  }

  /**
   * Resolves the email recipients for an organization's customer/partner admins.
   * Prefers the primary admin user, then any active CUSTOMER_ADMIN/ADMIN members,
   * de-duplicated by email.
   */
  private async getOrganizationAdminRecipients(
    organizationId: string,
    db: DbClient = prisma,
  ): Promise<Array<{ email: string; name: string | null }>> {
    const [organization, members] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          primaryAdminUser: { select: { email: true, name: true, status: true, deletedAt: true } },
        },
      }),
      db.user.findMany({
        where: {
          status: UserStatus.ACTIVE,
          deletedAt: null,
          role: { in: [UserRole.CUSTOMER_ADMIN, UserRole.ADMIN] },
          OR: [
            { primaryOrganizationId: organizationId },
            { memberships: { some: { organizationId } } },
          ],
        },
        select: { email: true, name: true },
      }),
    ]);

    const byEmail = new Map<string, { email: string; name: string | null }>();
    const primary = organization?.primaryAdminUser;
    if (primary?.email && !primary.deletedAt && primary.status === UserStatus.ACTIVE) {
      byEmail.set(primary.email.toLowerCase(), {
        email: primary.email,
        name: primary.name ?? null,
      });
    }
    for (const member of members) {
      if (!member.email) continue;
      const key = member.email.toLowerCase();
      if (!byEmail.has(key)) {
        byEmail.set(key, { email: member.email, name: member.name ?? null });
      }
    }
    return Array.from(byEmail.values());
  }

  async assertOrganizationCanLogin(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { primaryOrganization: true },
    });
    if (!user) throw new AppError('User not found', 404);
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (!user.primaryOrganization) {
      throw new AppError('Organization assignment is required before login', 403);
    }
    if (
      user.primaryOrganization.deletedAt ||
      user.primaryOrganization.status !== OrganizationStatus.ACTIVE
    ) {
      throw new AppError('Organization is inactive', 403);
    }
    if (
      user.primaryOrganization.teacherOnlyMode &&
      (user.role === UserRole.STUDENT || user.role === UserRole.PARENT)
    ) {
      throw new AppError('Student and parent dashboard logins are disabled for teacher-only organizations', 403);
    }
    if (user.role === UserRole.STUDENT && !user.primaryOrganization.studentLoginEnabled) {
      throw new AppError('Student logins are not enabled for this organization', 403);
    }
    if (user.role === UserRole.PARENT && !user.primaryOrganization.parentLoginEnabled) {
      throw new AppError('Parent logins are not enabled for this organization', 403);
    }
  }

  async assertCanActivateUserRole(input: {
    organizationId: string | null;
    role: UserRole;
    userIdToIgnore?: string;
  }): Promise<void> {
    if (!this.isLicensedRole(input.role)) return;
    if (!input.organizationId) {
      throw new AppError('Organization is required for licensed users', 400);
    }

    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (
      !organization ||
      organization.deletedAt ||
      organization.status !== OrganizationStatus.ACTIVE
    ) {
      throw new AppError('Active organization is required for licensed users', 400);
    }
    const subscription = await this.getActiveOrganizationSubscription(input.organizationId);
    if (!subscription) {
      throw new AppError('An active subscription is required before creating licensed users', 403);
    }
    if (!isActiveSubscriptionStatus(subscription.status)) {
      throw new AppError('Subscription is not active', 403);
    }

    const used = await prisma.user.count({
      where: {
        primaryOrganizationId: input.organizationId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        role: { in: [UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT] },
        ...(input.userIdToIgnore ? { id: { not: input.userIdToIgnore } } : {}),
      },
    });
    if (used >= subscription.seatLimit) {
      throw new AppError('Seat limit reached for this subscription', 409);
    }
  }

  async requireSuperAdmin(actor: AuthenticatedUserLike): Promise<void> {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('Only SoftLogic Super Admin can change commercial controls', 403);
    }
  }

  async listPaymentProviders(actor: AuthenticatedUserLike) {
    await this.requireSuperAdmin(actor);
    const row = await prisma.paymentProviderConfig.findUnique({
      where: { provider: PaymentProvider.MANUAL },
    });
    return [this.manualProviderDisplay(row)];
  }

  async updatePaymentProvider(
    actor: AuthenticatedUserLike,
    input: {
      provider: PaymentProvider;
      enabled: boolean;
      mode?: PaymentProviderMode;
    },
  ) {
    await this.requireSuperAdmin(actor);
    if (input.provider !== PaymentProvider.MANUAL) {
      throw new AppError('Only the manual provider is supported', 400);
    }
    const config = await prisma.paymentProviderConfig.upsert({
      where: { provider: PaymentProvider.MANUAL },
      update: {
        enabled: input.enabled,
        mode: input.mode ?? PaymentProviderMode.TEST,
      },
      create: {
        provider: PaymentProvider.MANUAL,
        enabled: input.enabled,
        mode: input.mode ?? PaymentProviderMode.TEST,
      },
    });
    await this.audit(actor, 'payment.provider.update', 'payment_provider', config.id, 'Updated manual payment provider');
    return config;
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
    await this.requireSuperAdmin(actor);
    if (input.organizationId) await ensureOrganizationManaged(input.organizationId, actor);
    const payment = await prisma.paymentTransaction.create({
      data: {
        provider: PaymentProvider.MANUAL,
        organizationId: input.organizationId ?? null,
        subscriptionId: input.subscriptionId ?? null,
        status: PaymentTransactionStatus.MANUAL_APPROVED,
        amountMinor: input.amountMinor,
        currency: input.currency ?? 'INR',
        referenceNote: input.referenceNote,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        recordedById: actor.userId,
      },
    });
    await this.audit(actor, 'payment.offline.approve', 'payment_transaction', payment.id, 'Recorded offline payment approval');
    return payment;
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
    await this.requireSuperAdmin(actor);
    await ensureOrganizationManaged(input.organizationId, actor);
    // #2 Default key expiry to the organization's active subscription endDate when not supplied.
    let expiresAt = input.expiresAt ?? null;
    if (!expiresAt) {
      const activeSubscription = await this.getActiveOrganizationSubscription(
        input.organizationId,
      );
      expiresAt = activeSubscription?.endDate ?? null;
    }
    // #28 maxDevices defaults to 1 (today's single-device behavior). Clamp to >= 1.
    const maxDevices = Math.max(1, Math.trunc(input.maxDevices ?? 1));
    const rawKey = `SL-${randomBytes(12).toString('hex').toUpperCase()}`;
    const record = await prisma.hardwareActivationKey.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId ?? null,
        activationKeyHash: hashSecret(rawKey),
        activationKeyEncrypted: encryptSecret(rawKey),
        assignedUserId: input.assignedUserId ?? null,
        createdById: actor.userId,
        label: input.label,
        expiresAt,
        maxDevices,
      },
    });
    await this.audit(actor, 'hardware.activation_key.create', 'hardware_activation_key', record.id, 'Created hardware activation key');
    return { ...record, activationKey: rawKey };
  }

  /**
   * Bulk-creates hardware activation keys for an organization. Loops the single-key
   * createHardwareActivationKey (same scope checks, expiry defaulting, maxDevices clamp and
   * plaintext key surfacing) so behavior matches single-create exactly. Audited once with the count.
   */
  async bulkCreateHardwareActivationKeys(
    actor: AuthenticatedUserLike,
    input: {
      organizationId: string;
      subscriptionId?: string | null;
      keys: Array<{
        label: string;
        maxDevices?: number | null;
        assignedUserId?: string | null;
        expiresAt?: Date | null;
      }>;
    },
  ) {
    const created: Array<
      Awaited<ReturnType<LicensingService['createHardwareActivationKey']>>
    > = [];
    for (const row of input.keys) {
      const record = await this.createHardwareActivationKey(actor, {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId ?? null,
        label: row.label,
        maxDevices: row.maxDevices ?? undefined,
        assignedUserId: row.assignedUserId ?? null,
        expiresAt: row.expiresAt ?? null,
      });
      created.push(record);
    }
    await this.audit(
      actor,
      'hardware.activation_key.bulk_create',
      'organization',
      input.organizationId,
      `Bulk-created ${created.length} hardware activation key(s)`,
    );
    return { createdCount: created.length, keys: created };
  }

  /**
   * Lists every PaymentTransaction tied to a subscription: those bound directly by subscriptionId
   * OR (when the subscription belongs to an organization) any payment recorded against that org.
   * Scoped via ensureOrganizationManaged on the subscription's organization (super admins pass
   * through; org-less subscriptions are still readable by super admins). Newest first; includes
   * the invoice/period fields and the recording admin.
   */
  async listSubscriptionPayments(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, organizationId: true },
    });
    if (!subscription) {
      throw new AppError('Subscription not found', 404);
    }
    if (subscription.organizationId) {
      await ensureOrganizationManaged(subscription.organizationId, actor);
    } else {
      await this.requireSuperAdmin(actor);
    }

    const or: Prisma.PaymentTransactionWhereInput[] = [
      { subscriptionId: subscription.id },
    ];
    if (subscription.organizationId) {
      or.push({ organizationId: subscription.organizationId });
    }

    const payments = await prisma.paymentTransaction.findMany({
      where: { OR: or },
      include: {
        recordedBy: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { payments };
  }

  /**
   * Builds an xlsx/csv export of an organization's hardware activation keys. Scoped via
   * ensureOrganizationManaged. NEVER includes the decrypted/plaintext key — secrets must not leak
   * through exports. "Bound Devices" counts activations currently in the ACTIVE state.
   */
  async exportHardwareActivationKeys(
    actor: AuthenticatedUserLike,
    input: { organizationId: string; format: AdminExportFormat },
  ) {
    await ensureOrganizationManaged(input.organizationId, actor);
    const keys = await prisma.hardwareActivationKey.findMany({
      where: { organizationId: input.organizationId },
      include: {
        assignedUser: { select: { id: true, email: true, name: true } },
        _count: {
          select: {
            activations: { where: { status: HardwareActivationStatus.ACTIVE } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return buildAdminExport({
      title: 'Activation Keys',
      fileBaseName: 'softlogic-activation-keys',
      format: input.format,
      rows: keys,
      filters: { organizationId: input.organizationId },
      columns: [
        { header: 'Label', key: 'label', width: 28, value: (row) => row.label ?? '' },
        { header: 'Status', key: 'status', width: 16, value: (row) => String(row.status) },
        { header: 'Max Devices', key: 'maxDevices', width: 14, value: (row) => row.maxDevices },
        { header: 'Bound Devices', key: 'boundDevices', width: 16, value: (row) => row._count.activations },
        { header: 'Assigned User Email', key: 'assignedUserEmail', width: 34, value: (row) => row.assignedUser?.email ?? '' },
        { header: 'Expires At', key: 'expiresAt', width: 22, value: (row) => row.expiresAt },
        { header: 'Created At', key: 'createdAt', width: 22, value: (row) => row.createdAt },
      ],
    });
  }

  async bindHardwareActivation(input: {
    activationKey: string;
    deviceFingerprint: string;
    deviceLabel?: string | null;
    deviceMeta?: DeviceMetaInput | null;
    userId?: string | null;
  }) {
    const fingerprintHash = hashSecret(input.deviceFingerprint);
    return prisma.$transaction(async (tx) => {
      const key = await tx.hardwareActivationKey.findUnique({
        where: { activationKeyHash: hashSecret(input.activationKey) },
      });
      if (!key || key.status === HardwareActivationKeyStatus.DISABLED) {
        throw new AppError('Invalid activation key', 404);
      }
      if (key.expiresAt && key.expiresAt <= new Date()) {
        await tx.hardwareActivationKey.update({
          where: { id: key.id },
          data: { status: HardwareActivationKeyStatus.EXPIRED },
        });
        throw new AppError('Activation key has expired', 410);
      }
      if (input.userId) {
        const user = await tx.user.findUnique({
          where: { id: input.userId },
          select: { primaryOrganizationId: true },
        });
        if (!user || user.primaryOrganizationId !== key.organizationId) {
          throw new AppError(
            'Activation key is not assigned to this organization',
            403,
          );
        }
      }
      // #28 Multi-device per key. If THIS device is already bound to the key, re-verify it.
      // Otherwise enforce the key's device limit (maxDevices, default 1 = today's behavior).
      const existing = await tx.hardwareActivation.findUnique({
        where: {
          activationKeyId_deviceFingerprintHash: {
            activationKeyId: key.id,
            deviceFingerprintHash: fingerprintHash,
          },
        },
      });
      if (existing) {
        const refreshed = await tx.hardwareActivation.update({
          where: { id: existing.id },
          data: {
            status: HardwareActivationStatus.ACTIVE,
            lastVerifiedAt: new Date(),
            userId: existing.userId ?? input.userId ?? null,
            deviceLabel: input.deviceLabel ?? existing.deviceLabel,
            devicePlatform: existing.devicePlatform ?? input.deviceMeta?.platform ?? null,
            deviceModel:
              existing.deviceModel ??
              this.composeModelLabel(input.deviceMeta) ??
              null,
            deviceOsVersion: existing.deviceOsVersion ?? input.deviceMeta?.osVersion ?? null,
            deviceMeta:
              ((Object.keys(this.metaToJson(existing.deviceMeta)).length === 0
                ? this.metaToJson(input.deviceMeta)
                : this.metaToJson(existing.deviceMeta)) as Prisma.InputJsonValue),
          },
        });
        // Keep the key's bound pointer/status coherent (notably restores BOUND if it was AVAILABLE after a reset).
        await tx.hardwareActivationKey.update({
          where: { id: key.id },
          data: {
            status: HardwareActivationKeyStatus.BOUND,
            boundActivationId: key.boundActivationId ?? refreshed.id,
          },
        });
        return refreshed;
      }

      const maxDevices = Math.max(1, key.maxDevices ?? 1);
      const boundDeviceCount = await tx.hardwareActivation.count({
        where: {
          activationKeyId: key.id,
          status: HardwareActivationStatus.ACTIVE,
        },
      });
      if (boundDeviceCount >= maxDevices) {
        throw new AppError(
          maxDevices === 1
            ? 'Activation key is already bound to another device'
            : `Activation key device limit reached (max ${maxDevices} device${maxDevices === 1 ? '' : 's'})`,
          409,
        );
      }

      const activation = await tx.hardwareActivation.create({
        data: {
          activationKeyId: key.id,
          organizationId: key.organizationId,
          userId: input.userId ?? key.assignedUserId ?? null,
          deviceFingerprintHash: fingerprintHash,
          deviceLabel: input.deviceLabel,
          devicePlatform: input.deviceMeta?.platform ?? null,
          deviceModel: this.composeModelLabel(input.deviceMeta),
          deviceOsVersion: input.deviceMeta?.osVersion ?? null,
          deviceMeta: this.metaToJson(input.deviceMeta) as Prisma.InputJsonValue,
          firstBoundAt: new Date(),
          lastVerifiedAt: new Date(),
        },
      });
      await tx.hardwareActivationKey.update({
        where: { id: key.id },
        data: {
          status: HardwareActivationKeyStatus.BOUND,
          // Preserve the existing bound pointer (first device) when present; set it on first bind.
          boundActivationId: key.boundActivationId ?? activation.id,
        },
      });
      return activation;
    });
  }

  async verifyHardwareActivation(input: {
    activationKey: string;
    deviceFingerprint: string;
    deviceMeta?: DeviceMetaInput | null;
    userId?: string | null;
  }): Promise<VerifyHardwareActivationResult> {
    const fingerprintHash = hashSecret(input.deviceFingerprint);
    const key = await prisma.hardwareActivationKey.findUnique({
      where: { activationKeyHash: hashSecret(input.activationKey) },
      include: {
        organization: { select: { id: true, name: true, status: true, deletedAt: true } },
        subscription: { select: { id: true, status: true, endDate: true } },
        boundActivation: true,
      },
    });
    if (!key) return { valid: false, reason: 'invalid_key' };
    if (input.userId) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { primaryOrganizationId: true },
      });
      if (!user || user.primaryOrganizationId !== key.organizationId) {
        return { valid: false, reason: 'organization_mismatch' };
      }
    }
    if (key.status === HardwareActivationKeyStatus.DISABLED) {
      return { valid: false, reason: 'disabled' };
    }
    if (key.expiresAt && key.expiresAt <= new Date()) {
      await prisma.hardwareActivationKey.update({
        where: { id: key.id },
        data: { status: HardwareActivationKeyStatus.EXPIRED },
      });
      return { valid: false, reason: 'expired' };
    }
    // #28 Multi-device: verify THIS device's own activation for the key (not just the primary).
    // For a single-device key (maxDevices=1) the matching activation is the bound one, so the
    // existing behavior and reason codes are preserved.
    const deviceActivation = await prisma.hardwareActivation.findUnique({
      where: {
        activationKeyId_deviceFingerprintHash: {
          activationKeyId: key.id,
          deviceFingerprintHash: fingerprintHash,
        },
      },
    });
    if (!deviceActivation) {
      // This device was never bound. If other devices hold the key, surface the existing
      // "bound to another device" signal; otherwise the key has no binding yet.
      if (key.boundActivation) {
        return {
          valid: false,
          reason: 'bound_to_other_device',
          boundDeviceMeta: {
            platform: key.boundActivation.devicePlatform,
            model: key.boundActivation.deviceModel,
            osVersion: key.boundActivation.deviceOsVersion,
            firstBoundAt: key.boundActivation.firstBoundAt,
          },
        };
      }
      return { valid: false, reason: 'not_bound' };
    }
    if (deviceActivation.status !== HardwareActivationStatus.ACTIVE) {
      return { valid: false, reason: 'inactive_activation' };
    }
    if (
      key.organization.deletedAt ||
      key.organization.status !== OrganizationStatus.ACTIVE
    ) {
      return { valid: false, reason: 'organization_inactive' };
    }
    if (
      key.subscription &&
      !isActiveSubscriptionStatus(key.subscription.status)
    ) {
      return { valid: false, reason: 'subscription_inactive' };
    }

    const updated = await prisma.hardwareActivation.update({
      where: { id: deviceActivation.id },
      data: {
        lastVerifiedAt: new Date(),
        userId: deviceActivation.userId ?? input.userId ?? null,
      },
    });

    return {
      valid: true,
      organizationId: key.organizationId,
      organizationName: key.organization.name,
      subscriptionId: key.subscriptionId ?? undefined,
      expiresAt: key.expiresAt,
      lastVerifiedAt: updated.lastVerifiedAt,
    };
  }

  async resetHardwareActivation(
    actor: AuthenticatedUserLike,
    activationId: string,
  ) {
    await this.requireSuperAdmin(actor);
    const activation = await prisma.hardwareActivation.update({
      where: { id: activationId },
      data: {
        status: HardwareActivationStatus.RESET,
        resetApprovedAt: new Date(),
        resetApprovedById: actor.userId,
      },
    });
    await prisma.hardwareActivationKey.updateMany({
      where: { boundActivationId: activationId },
      data: { boundActivationId: null, status: HardwareActivationKeyStatus.AVAILABLE },
    });
    await this.audit(actor, 'hardware.activation.reset', 'hardware_activation', activationId, 'Reset hardware activation');
    return activation;
  }

  async getSubscriptionDetails(
    actor: AuthenticatedUserLike,
    subscriptionId: string,
  ) {
    await this.requireSuperAdmin(actor);
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        organization: true,
        user: { select: { id: true, email: true, name: true, role: true } },
        hardwareActivationKeys: {
          include: {
            assignedUser: { select: { id: true, email: true, name: true } },
            activations: {
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!subscription) {
      throw new AppError('Subscription not found', 404);
    }
    if (subscription.organizationId) {
      await ensureOrganizationManaged(subscription.organizationId, actor);
    }
    return {
      ...subscription,
      hardwareActivationKeys: subscription.hardwareActivationKeys.map((key) => ({
        ...key,
        activationKey: tryDecryptSecret(key.activationKeyEncrypted),
      })),
    };
  }

  async getOrganizationLicenseDetails(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ) {
    // #8 Scoped access: SUPER_ADMIN may view any org; PARTNER_ADMIN/CUSTOMER_ADMIN/ADMIN may view
    // only organizations within their managed scope. ensureOrganizationManaged enforces both —
    // super admins pass through, scoped admins are checked against getManagedOrganizationIds.
    await ensureOrganizationManaged(organizationId, actor);
    const [organization, subscriptions, hardwareActivationKeys] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          status: true,
          primaryAdminUserId: true,
          primaryAdminUser: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.subscription.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.hardwareActivationKey.findMany({
        where: { organizationId },
        include: {
          assignedUser: { select: { id: true, email: true, name: true } },
          activations: { orderBy: { createdAt: 'desc' } },
          boundActivation: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!organization) {
      throw new AppError('Organization not found', 404);
    }
    return {
      organization,
      subscriptions,
      hardwareActivationKeys: hardwareActivationKeys.map((key) => ({
        ...key,
        activationKey: tryDecryptSecret(key.activationKeyEncrypted),
      })),
    };
  }

  async emailActivationKeysToOrgAdmin(
    actor: AuthenticatedUserLike,
    organizationId: string,
  ): Promise<{ delivered: boolean; recipient?: string; keyCount: number }> {
    await this.requireSuperAdmin(actor);
    await ensureOrganizationManaged(organizationId, actor);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        primaryAdminUser: { select: { id: true, email: true, name: true } },
      },
    });
    if (!organization) {
      throw new AppError('Organization not found', 404);
    }
    if (!organization.primaryAdminUser?.email) {
      throw new AppError('Organization has no primary admin email', 400);
    }
    const keys = await prisma.hardwareActivationKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const decoded = keys
      .map((row) => ({
        label: row.label ?? '—',
        status: row.status,
        expiresAt: row.expiresAt,
        plain: tryDecryptSecret(row.activationKeyEncrypted),
      }))
      .filter((row) => row.plain);
    const { sendActivationKeysEmail } = await import('@/shared/utils/email');
    await sendActivationKeysEmail({
      to: organization.primaryAdminUser.email,
      organizationName: organization.name,
      adminName: organization.primaryAdminUser.name ?? null,
      keys: decoded.map((row) => ({
        label: row.label,
        status: String(row.status),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        plain: row.plain ?? '',
      })),
    });
    await this.audit(
      actor,
      'hardware.activation_key.email',
      'organization',
      organizationId,
      `Emailed ${decoded.length} activation key(s) to org admin`,
    );
    return {
      delivered: true,
      recipient: organization.primaryAdminUser.email,
      keyCount: decoded.length,
    };
  }

  /**
   * #12 Renew a subscription. Sets the status back to ACTIVE, updates endDate (and startDate if
   * it had expired), optionally records an offline manual payment, and optionally bumps the
   * organization's activation keys' expiresAt to the new endDate. Resets alert/reminder tiers so
   * future seat/expiry warnings re-evaluate from a clean slate. Scoped to super admin / managed orgs.
   */
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
    await this.requireSuperAdmin(actor);
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

    const wasExpired =
      existing.status === SubscriptionStatus.EXPIRED ||
      existing.status === SubscriptionStatus.CANCELED;

    const result = await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          endDate: input.newEndDate,
          // Restart the term if the subscription had lapsed.
          startDate: wasExpired ? new Date() : existing.startDate,
          // Renewed term — clear dedupe tiers so seat/expiry alerts re-evaluate.
          seatAlertTier: null,
          expiryReminderTier: null,
        },
        include: {
          organization: true,
          user: { select: { id: true, email: true, name: true, role: true } },
        },
      });

      let payment = null;
      if (input.payment) {
        payment = await tx.paymentTransaction.create({
          data: {
            provider: PaymentProvider.MANUAL,
            organizationId: subscription.organizationId ?? null,
            subscriptionId: subscription.id,
            status: PaymentTransactionStatus.MANUAL_APPROVED,
            amountMinor: input.payment.amountMinor,
            currency: input.payment.currency ?? 'INR',
            referenceNote: input.payment.referenceNote ?? 'Subscription renewal',
            metadata: { kind: 'subscription_renewal' } as Prisma.InputJsonValue,
            recordedById: actor.userId,
          },
        });
      }

      let extendedKeyCount = 0;
      if (input.extendKeys && subscription.organizationId) {
        const bumped = await tx.hardwareActivationKey.updateMany({
          where: {
            organizationId: subscription.organizationId,
            status: { not: HardwareActivationKeyStatus.DISABLED },
          },
          data: { expiresAt: input.newEndDate },
        });
        extendedKeyCount = bumped.count;
        // Reactivate keys that had auto-expired but now fall within the renewed term.
        await tx.hardwareActivationKey.updateMany({
          where: {
            organizationId: subscription.organizationId,
            status: HardwareActivationKeyStatus.EXPIRED,
            expiresAt: { gt: new Date() },
          },
          data: { status: HardwareActivationKeyStatus.AVAILABLE },
        });
      }

      return { subscription, payment, extendedKeyCount };
    });

    if (result.subscription.organizationId) {
      await this.recalculateLicenseUsage(result.subscription.organizationId);
    }

    await this.audit(
      actor,
      'subscription.renew',
      'subscription',
      subscriptionId,
      `Renewed subscription ${result.subscription.planName} until ${input.newEndDate.toISOString()}${
        result.payment ? ' (offline payment recorded)' : ''
      }${input.extendKeys ? `; extended ${result.extendedKeyCount} key(s)` : ''}`,
    );

    return result.subscription;
  }

  /**
   * #1 Auto-expire sweep + expiry reminder emails (invoked by the Vercel cron job).
   * (a) Sets ACTIVE subscriptions whose endDate is in the past to EXPIRED.
   * (b) For ACTIVE subscriptions expiring within 30/14/7/0 days, emails the org admin(s), deduped
   *     via `expiryReminderTier` (only when the current days-left tier is a NEW, smaller tier).
   * Returns a summary count. Never throws on individual email failures.
   */
  async sweepSubscriptions(): Promise<{
    expired: number;
    remindersSent: number;
    checked: number;
  }> {
    const now = new Date();

    // (a) Expire lapsed ACTIVE subscriptions.
    const expiredResult = await prisma.subscription.updateMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endDate: { not: null, lt: now },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    // (b) Reminders for ACTIVE subscriptions expiring within the largest tier window.
    const maxTierDays = Math.max(...EXPIRY_REMINDER_TIERS);
    const horizon = new Date(now.getTime() + (maxTierDays + 1) * DAY_MS);
    const upcoming = await prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endDate: { not: null, lte: horizon },
      },
      select: {
        id: true,
        organizationId: true,
        endDate: true,
        expiryReminderTier: true,
      },
    });

    let remindersSent = 0;
    for (const subscription of upcoming) {
      try {
        if (!subscription.endDate || !subscription.organizationId) continue;
        const daysLeft = daysUntil(subscription.endDate, now);
        const tier = currentExpiryTier(daysLeft);
        if (tier === null) continue;

        // Only email when this is a new, closer (smaller) tier than already sent.
        const stored = subscription.expiryReminderTier ?? null;
        if (stored !== null && tier >= stored) continue;

        const organization = await prisma.organization.findUnique({
          where: { id: subscription.organizationId },
          select: { id: true, name: true },
        });
        if (organization) {
          const recipients = await this.getOrganizationAdminRecipients(
            subscription.organizationId,
          );
          for (const recipient of recipients) {
            await sendSubscriptionExpiryEmail({
              to: recipient.email,
              orgName: organization.name,
              endDate: subscription.endDate,
              daysLeft: Math.max(daysLeft, 0),
              adminName: recipient.name,
            });
          }
        }

        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { expiryReminderTier: tier },
        });
        remindersSent += 1;
      } catch (error) {
        console.error('Subscription expiry reminder failed:', error);
      }
    }

    return {
      expired: expiredResult.count,
      remindersSent,
      checked: upcoming.length,
    };
  }

  async extendAiCredits(
    _actor: AuthenticatedUserLike,
    _input: {
      accountId?: string;
      scope?: AiCreditScope;
      organizationId?: string | null;
      userId?: string | null;
      hardwareActivationKeyId?: string | null;
      amountMinor: number;
      reason?: string | null;
      referenceNote?: string | null;
    },
  ): Promise<never> {
    throw new AppError('AI Credits — Coming Soon', 503);
  }

  async ensureAiCreditAccount(input: {
    scope: AiCreditScope;
    organizationId?: string | null;
    userId?: string | null;
    hardwareActivationKeyId?: string | null;
    actorUserId?: string | null;
  }) {
    const existing = await prisma.aiCreditAccount.findFirst({
      where: {
        scope: input.scope,
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        hardwareActivationKeyId: input.hardwareActivationKeyId ?? null,
      },
    });
    if (existing) return existing;

    const account = await prisma.aiCreditAccount.create({
      data: {
        scope: input.scope,
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        hardwareActivationKeyId: input.hardwareActivationKeyId ?? null,
        balanceMinor: 0,
        includedMinor: 0,
        status: AiCreditAccountStatus.DISABLED,
      },
    });
    await prisma.aiCreditLedgerEntry.create({
      data: {
        accountId: account.id,
        actorUserId: input.actorUserId ?? null,
        type: AiCreditLedgerType.INCLUDED,
        amountMinor: 0,
        oldBalanceMinor: 0,
        newBalanceMinor: 0,
        reason: 'Account placeholder — AI Credits feature disabled',
      },
    });
    return account;
  }

  licenseLimitFor(
    subscription: { seatLimit: number },
    _role: UserRole,
  ): number {
    return subscription.seatLimit;
  }

  private poolSnapshot(total: number, used: number): SeatSnapshot {
    return { total, used, remaining: Math.max(total - used, 0) };
  }

  private manualProviderDisplay(row?: PaymentProviderConfig | null) {
    if (!row) {
      return {
        id: '',
        provider: PaymentProvider.MANUAL,
        enabled: true,
        mode: PaymentProviderMode.TEST,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return {
      ...row,
    };
  }

  private composeModelLabel(meta?: DeviceMetaInput | null): string | null {
    if (!meta) return null;
    const parts = [meta.manufacturer, meta.model].filter((value): value is string =>
      Boolean(value && String(value).trim()),
    );
    return parts.length ? parts.join(' ') : null;
  }

  private metaToJson(meta: unknown): Record<string, unknown> {
    if (!meta || typeof meta !== 'object') return {};
    return meta as Record<string, unknown>;
  }

  private async audit(
    actor: AuthenticatedUserLike,
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
  ) {
    await prisma.adminAuditLog.create({
      data: { actorUserId: actor.userId, action, targetType, targetId, summary },
    });
  }
}

export const licensingService = new LicensingService();
