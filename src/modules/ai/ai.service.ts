import { createHash } from 'crypto';
import {
  AiCreditAccount,
  AiCreditAccountStatus,
  AiCreditLedgerType,
  AiCreditScope,
  AiFeatureUsageAttemptStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { logger } from '@/shared/middleware/logger.middleware';
import {
  AuthenticatedUserLike,
  ensureOrganizationManaged,
  getManagedOrganizationIds,
} from '@/shared/utils/access-control';
import { decryptSecret, encryptSecret, tryDecryptSecret } from '@/shared/utils/cipher';
import { emitAiCreditUpdate } from './ai.realtime';
import {
  AiPricingRecord,
  AiUsageEstimate,
  DEFAULT_AI_MODEL_PRICING,
  billableSearchGroundingCount,
  calculateAiCredits,
  extractGeminiUsageBreakdown,
  requestedImageCount,
  responseImageCount,
  responseSearchGroundingCount,
} from './ai.pricing';
import { GoogleBillingConfigInput, aiGoogleBillingService } from './ai.google-billing';

const MASTER_ACCOUNT_ID = 'master';
const MASTER_CONFIG_ID = 'master';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TEXT_TO_MEDIA_FEATURE = 'text_to_media';
const TEXT_TO_MEDIA_LIMIT = 2;
const TEXT_TO_MEDIA_WINDOW_MS = 24 * 60 * 60 * 1000;
const AI_USER_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.CUSTOMER_ADMIN,
  UserRole.ADMIN,
  UserRole.TEACHER,
]);

type GeminiProxyInput = {
  modelId: string;
  data: Record<string, unknown>;
  enableGoogleSearch?: boolean;
  feature?: string;
  operation?: 'generateContent' | 'predict';
};

type AllocationInput = {
  sourceAccountId?: string | null;
  scope: AiCreditScope;
  organizationId?: string | null;
  userId?: string | null;
  amountTokens: number;
  reason?: string | null;
  referenceNote?: string | null;
};

type SetAllocationInput = {
  sourceAccountId?: string | null;
  scope: AiCreditScope;
  organizationId?: string | null;
  userId?: string | null;
  allocatedTokens: number;
  reason?: string | null;
  referenceNote?: string | null;
};

type AiTargetAccountInput = {
  scope: AiCreditScope;
  organizationId?: string | null;
  userId?: string | null;
};

type TopUpInput = {
  accountId?: string | null;
  amountTokens: number;
  reason?: string | null;
  referenceNote?: string | null;
};

type AiConfigInput = {
  geminiApiKey?: string | null;
  geminiTextModel?: string;
  geminiImageModel?: string;
  geminiTtsModel?: string;
  googleSearchGroundingEnabled?: boolean;
  enabled?: boolean;
};

type AiPricingInput = {
  modelId: string;
  provider?: string;
  billingType?: string;
  inputUsdMicrosPerMillion?: number;
  outputUsdMicrosPerMillion?: number;
  imageUsdMicrosEach?: number;
  searchUsdMicrosPerThousand?: number;
  enabled?: boolean;
};

type AiFeatureAttemptInput = {
  featureKey?: string;
  attemptId?: string;
  metadata?: Record<string, unknown>;
};

const toBig = (value: number | bigint): bigint =>
  typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.trunc(value)));

const tokenNumber = (value: bigint | number | null | undefined): number =>
  Number(value ?? 0);

const accountAvailable = (account: Pick<
  AiCreditAccount,
  'allocatedTokens' | 'usedTokens' | 'reservedTokens' | 'childAllocatedTokens'
>): bigint =>
  account.allocatedTokens -
  account.usedTokens -
  account.reservedTokens -
  account.childAllocatedTokens;

const accountSpent = (account: Pick<AiCreditAccount, 'usedTokens' | 'reservedTokens' | 'childAllocatedTokens'>): bigint =>
  account.usedTokens + account.reservedTokens + account.childAllocatedTokens;

const accountDeficit = (account: Pick<
  AiCreditAccount,
  'allocatedTokens' | 'usedTokens' | 'reservedTokens' | 'childAllocatedTokens'
>): bigint => {
  const available = accountAvailable(account);
  return available < 0n ? -available : 0n;
};

const subtractChildAllocation = (account: Pick<AiCreditAccount, 'childAllocatedTokens'>, amount: bigint): bigint =>
  account.childAllocatedTokens > amount ? account.childAllocatedTokens - amount : 0n;

const warningLevelFor = (available: bigint, allocated: bigint): 'NONE' | 'LOW_20' | 'LOW_10' | 'LOW_5' | 'EXHAUSTED' => {
  if (allocated <= 0n || available <= 0n) return 'EXHAUSTED';
  const percent = Number((available * 10000n) / allocated) / 100;
  if (percent <= 5) return 'LOW_5';
  if (percent <= 10) return 'LOW_10';
  if (percent <= 20) return 'LOW_20';
  return 'NONE';
};

const maskKey = (last4?: string | null): string | null =>
  last4 ? `••••••••${last4}` : null;

const keyFingerprint = (key: string): string =>
  createHash('sha256').update(key.trim()).digest('hex');

const normalizeModel = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed || fallback;
};

const jsonValue = (value: Record<string, unknown>): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

class AiService {
  async getOverview(actor: AuthenticatedUserLike) {
    await this.ensureDefaultPricing();
    await this.reconcileUserAccountParents();
    await this.reconcileOverdrawnUsageAccounts();
    const [config, masterAccount] = await Promise.all([
      this.ensureConfig(),
      this.ensureMasterAccount(),
    ]);
    const managedOrganizationIds = await getManagedOrganizationIds(actor);
    const accountWhere =
      managedOrganizationIds === null
        ? {}
        : {
            OR: [
              { organizationId: { in: managedOrganizationIds } },
              { user: { primaryOrganizationId: { in: managedOrganizationIds } } },
            ],
          };

    const [accounts, organizations, users, recentLedger, pricing, googleBilling, accountTotals] = await Promise.all([
      prisma.aiCreditAccount.findMany({
        where: accountWhere,
        include: {
          organization: { select: { id: true, name: true, slug: true, kind: true, parentOrganizationId: true } },
          user: { select: { id: true, email: true, name: true, role: true, primaryOrganizationId: true } },
          parentAccount: { select: { id: true, scope: true, organizationId: true, userId: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.organization.findMany({
        where:
          managedOrganizationIds === null
            ? { deletedAt: null }
            : { id: { in: managedOrganizationIds }, deletedAt: null },
        select: { id: true, name: true, slug: true, kind: true, parentOrganizationId: true, status: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where:
          managedOrganizationIds === null
            ? { deletedAt: null, role: { in: Array.from(AI_USER_ROLES) } }
            : {
                deletedAt: null,
                role: { in: Array.from(AI_USER_ROLES) },
                primaryOrganizationId: { in: managedOrganizationIds },
              },
        select: { id: true, email: true, name: true, role: true, primaryOrganizationId: true, status: true },
        orderBy: { email: 'asc' },
        take: 500,
      }),
      prisma.aiCreditLedgerEntry.findMany({
        where:
          managedOrganizationIds === null
            ? {}
            : {
                account: {
                  OR: [
                    { organizationId: { in: managedOrganizationIds } },
                    { user: { primaryOrganizationId: { in: managedOrganizationIds } } },
                  ],
                },
              },
        include: {
          actorUser: { select: { id: true, email: true, name: true, role: true } },
          account: {
            select: {
              id: true,
              scope: true,
              organizationId: true,
              userId: true,
              organization: { select: { id: true, name: true } },
              user: { select: { id: true, email: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.aiModelPricing.findMany({
        orderBy: [{ enabled: 'desc' }, { modelId: 'asc' }],
      }),
      actor.role === UserRole.SUPER_ADMIN ? aiGoogleBillingService.summary() : Promise.resolve(null),
      prisma.aiCreditAccount.aggregate({
        where: accountWhere,
        _sum: {
          usedTokens: true,
          reservedTokens: true,
        },
      }),
    ]);
    const masterSummary = this.accountSummary(masterAccount);

    return {
      generatedAt: new Date().toISOString(),
      scope: {
        type: managedOrganizationIds === null ? 'GLOBAL' : 'MANAGED',
        organizationIds: managedOrganizationIds,
      },
      config: this.configSummary(config),
      pricing: pricing.map((row) => this.pricingSummary(row)),
      master: {
        ...masterSummary,
        usedTokens: tokenNumber(accountTotals._sum.usedTokens),
        reservedTokens: tokenNumber(accountTotals._sum.reservedTokens),
      },
      accounts: accounts.map((account) => this.accountSummary(account)),
      organizations,
      users,
      googleBilling,
      recentLedger: recentLedger.map((entry) => ({
        ...entry,
        amountTokens: tokenNumber(entry.amountTokens),
        oldTokenBalance: tokenNumber(entry.oldTokenBalance),
        newTokenBalance: tokenNumber(entry.newTokenBalance),
        inputTokens: tokenNumber(entry.inputTokens),
        outputTokens: tokenNumber(entry.outputTokens),
        thinkingTokens: tokenNumber(entry.thinkingTokens),
        totalTokens: tokenNumber(entry.totalTokens),
        estimatedCostMicros: tokenNumber(entry.estimatedCostMicros),
      })),
    };
  }

  async updateConfig(actor: AuthenticatedUserLike, input: AiConfigInput) {
    this.assertSuperAdmin(actor);
    const current = await this.ensureConfig();
    const next: Prisma.AiMasterConfigUpdateInput = {
      geminiTextModel: normalizeModel(input.geminiTextModel, current.geminiTextModel),
      geminiImageModel: normalizeModel(input.geminiImageModel, current.geminiImageModel),
      geminiTtsModel: normalizeModel(input.geminiTtsModel, current.geminiTtsModel),
      googleSearchGroundingEnabled:
        input.googleSearchGroundingEnabled ?? current.googleSearchGroundingEnabled,
      enabled: input.enabled ?? current.enabled,
    };
    const key = input.geminiApiKey?.trim();
    if (key) {
      next.geminiApiKeyEncrypted = encryptSecret(key);
      next.geminiApiKeyFingerprint = keyFingerprint(key);
      next.geminiApiKeyLast4 = key.slice(-4);
    }
    const updated = await prisma.aiMasterConfig.update({
      where: { id: MASTER_CONFIG_ID },
      data: next,
    });
    emitAiCreditUpdate({ type: 'ai.config.updated', actorUserId: actor.userId });
    return this.configSummary(updated);
  }

  async updatePricing(actor: AuthenticatedUserLike, input: AiPricingInput[]) {
    this.assertSuperAdmin(actor);
    const updated = await prisma.$transaction(
      input.map((row) =>
        prisma.aiModelPricing.upsert({
          where: { modelId: row.modelId.trim() },
          update: {
            provider: row.provider?.trim() || 'gemini',
            billingType: row.billingType?.trim() || 'token',
            inputUsdMicrosPerMillion: Math.max(0, Math.trunc(row.inputUsdMicrosPerMillion ?? 0)),
            outputUsdMicrosPerMillion: Math.max(0, Math.trunc(row.outputUsdMicrosPerMillion ?? 0)),
            imageUsdMicrosEach: Math.max(0, Math.trunc(row.imageUsdMicrosEach ?? 0)),
            searchUsdMicrosPerThousand: Math.max(0, Math.trunc(row.searchUsdMicrosPerThousand ?? 0)),
            enabled: row.enabled ?? true,
          },
          create: {
            provider: row.provider?.trim() || 'gemini',
            modelId: row.modelId.trim(),
            billingType: row.billingType?.trim() || 'token',
            inputUsdMicrosPerMillion: Math.max(0, Math.trunc(row.inputUsdMicrosPerMillion ?? 0)),
            outputUsdMicrosPerMillion: Math.max(0, Math.trunc(row.outputUsdMicrosPerMillion ?? 0)),
            imageUsdMicrosEach: Math.max(0, Math.trunc(row.imageUsdMicrosEach ?? 0)),
            searchUsdMicrosPerThousand: Math.max(0, Math.trunc(row.searchUsdMicrosPerThousand ?? 0)),
            enabled: row.enabled ?? true,
          },
        }),
      ),
    );
    emitAiCreditUpdate({ type: 'ai.pricing.updated', actorUserId: actor.userId });
    return updated.map((row) => this.pricingSummary(row));
  }

  async updateGoogleBillingConfig(actor: AuthenticatedUserLike, input: GoogleBillingConfigInput) {
    this.assertSuperAdmin(actor);
    return aiGoogleBillingService.updateConfig(input);
  }

  async syncGoogleBilling(actor: AuthenticatedUserLike) {
    this.assertSuperAdmin(actor);
    return aiGoogleBillingService.syncNow();
  }

  async reserveFeatureAttempt(actor: AuthenticatedUserLike, input: AiFeatureAttemptInput = {}) {
    this.assertAiUser(actor);
    const featureKey = this.normalizeFeatureKey(input.featureKey);
    const since = new Date(Date.now() - TEXT_TO_MEDIA_WINDOW_MS);
    const result = await prisma.$transaction(async (tx) => {
      const used = await tx.aiFeatureUsageAttempt.count({
        where: {
          userId: actor.userId,
          featureKey,
          status: {
            in: [
              AiFeatureUsageAttemptStatus.RESERVED,
              AiFeatureUsageAttemptStatus.COMMITTED,
            ],
          },
          createdAt: { gte: since },
        },
      });
      if (used >= TEXT_TO_MEDIA_LIMIT) {
        throw new AppError(
          'Text to Media limit reached. You can generate 2 AI images every 24 hours. Use Browser Images or Gemini in the embedded browser meanwhile.',
          429,
        );
      }
      const attempt = await tx.aiFeatureUsageAttempt.create({
        data: {
          userId: actor.userId,
          featureKey,
          status: AiFeatureUsageAttemptStatus.RESERVED,
          metadata: jsonValue(input.metadata ?? {}),
        },
      });
      return { attempt, usedAfterReserve: used + 1 };
    });
    return this.featureAttemptSummary(result.attempt, result.usedAfterReserve);
  }

  async commitFeatureAttempt(actor: AuthenticatedUserLike, input: AiFeatureAttemptInput) {
    this.assertAiUser(actor);
    const attempt = await this.updateOwnFeatureAttempt(
      actor,
      input,
      AiFeatureUsageAttemptStatus.COMMITTED,
    );
    const used = await this.featureAttemptsUsed(actor.userId, attempt.featureKey);
    return this.featureAttemptSummary(attempt, used);
  }

  async failFeatureAttempt(actor: AuthenticatedUserLike, input: AiFeatureAttemptInput) {
    this.assertAiUser(actor);
    const attempt = await this.updateOwnFeatureAttempt(
      actor,
      input,
      AiFeatureUsageAttemptStatus.FAILED,
    );
    const used = await this.featureAttemptsUsed(actor.userId, attempt.featureKey);
    return this.featureAttemptSummary(attempt, used);
  }

  async testConfig(actor: AuthenticatedUserLike, input: AiConfigInput = {}) {
    this.assertSuperAdmin(actor);
    const config = await this.ensureConfig();
    const key = input.geminiApiKey?.trim() || tryDecryptSecret(config.geminiApiKeyEncrypted);
    if (!key) throw new AppError('Master Gemini API key is not configured', 400);
    const modelId = normalizeModel(input.geminiTextModel, config.geminiTextModel);
    try {
      await this.postGemini(`${modelId}:countTokens`, key, {
        contents: [{ role: 'user', parts: [{ text: 'SoftLogic AI configuration test' }] }],
      });
      const updated = await prisma.aiMasterConfig.update({
        where: { id: MASTER_CONFIG_ID },
        data: {
          lastTestedAt: new Date(),
          lastTestStatus: 'SUCCESS',
          lastTestMessage: 'Gemini key and model responded successfully',
        },
      });
      return this.configSummary(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gemini test failed';
      const updated = await prisma.aiMasterConfig.update({
        where: { id: MASTER_CONFIG_ID },
        data: {
          lastTestedAt: new Date(),
          lastTestStatus: 'FAILED',
          lastTestMessage: message,
        },
      });
      return this.configSummary(updated);
    }
  }

  async topUp(actor: AuthenticatedUserLike, input: TopUpInput) {
    this.assertSuperAdmin(actor);
    const amount = toBig(input.amountTokens);
    const accountId = input.accountId?.trim() || MASTER_ACCOUNT_ID;
    const committed = await prisma.$transaction(async (tx) => {
      const account = await tx.aiCreditAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new AppError('AI credit account not found', 404);
      const before = accountAvailable(account);
      const next = await tx.aiCreditAccount.update({
        where: { id: account.id },
        data: {
          allocatedTokens: { increment: amount },
          status: AiCreditAccountStatus.ACTIVE,
        },
      });
      const after = accountAvailable(next);
      await tx.aiCreditLedgerEntry.create({
        data: {
          accountId: account.id,
          actorUserId: actor.userId,
          type: account.id === MASTER_ACCOUNT_ID
            ? AiCreditLedgerType.MASTER_TOP_UP
            : AiCreditLedgerType.MANUAL_EXTENSION,
          amountMinor: 0,
          oldBalanceMinor: account.balanceMinor,
          newBalanceMinor: account.balanceMinor,
          amountTokens: amount,
          oldTokenBalance: before,
          newTokenBalance: after,
          reason: input.reason ?? 'AI credit top-up',
          referenceNote: input.referenceNote ?? null,
        },
      });
      return next;
    });
    emitAiCreditUpdate({ type: 'ai.credits.top_up', accountId: committed.id });
    return this.accountSummary(committed);
  }

  async allocate(actor: AuthenticatedUserLike, input: AllocationInput) {
    const amount = toBig(input.amountTokens);
    const source = await this.resolveSourceAccountForTarget(actor, input);
    const target = await this.resolveTargetAccount(actor, input, source.id);
    if (source.id === target.id) {
      throw new AppError('Source and target AI account must be different', 400);
    }
    const updatedTarget = await prisma.$transaction(async (tx) => {
      const sourceAccount = await tx.aiCreditAccount.findUnique({ where: { id: source.id } });
      const targetAccount = await tx.aiCreditAccount.findUnique({ where: { id: target.id } });
      if (!sourceAccount || !targetAccount) throw new AppError('AI credit account not found', 404);
      const sourceBefore = accountAvailable(sourceAccount);
      if (sourceBefore < amount) {
        throw new AppError('Not enough AI credits available to allocate', 409);
      }
      const sourceAfterAccount = await tx.aiCreditAccount.update({
        where: { id: sourceAccount.id },
        data: { childAllocatedTokens: { increment: amount } },
      });
      const targetAfterAccount = await tx.aiCreditAccount.update({
        where: { id: targetAccount.id },
        data: {
          allocatedTokens: { increment: amount },
          parentAccountId: sourceAccount.id,
          status: AiCreditAccountStatus.ACTIVE,
        },
      });
      await tx.aiCreditLedgerEntry.createMany({
        data: [
          {
            accountId: sourceAccount.id,
            actorUserId: actor.userId,
            type: AiCreditLedgerType.ALLOCATION,
            amountMinor: 0,
            oldBalanceMinor: sourceAccount.balanceMinor,
            newBalanceMinor: sourceAccount.balanceMinor,
            amountTokens: -amount,
            oldTokenBalance: sourceBefore,
            newTokenBalance: accountAvailable(sourceAfterAccount),
            reason: input.reason ?? 'AI credit allocation',
            referenceNote: input.referenceNote ?? null,
            metadata: jsonValue({ targetAccountId: targetAccount.id }),
          },
          {
            accountId: targetAccount.id,
            actorUserId: actor.userId,
            type: AiCreditLedgerType.ALLOCATION,
            amountMinor: 0,
            oldBalanceMinor: targetAccount.balanceMinor,
            newBalanceMinor: targetAccount.balanceMinor,
            amountTokens: amount,
            oldTokenBalance: accountAvailable(targetAccount),
            newTokenBalance: accountAvailable(targetAfterAccount),
            reason: input.reason ?? 'AI credit allocation',
            referenceNote: input.referenceNote ?? null,
            metadata: jsonValue({ sourceAccountId: sourceAccount.id }),
          },
        ],
      });
      return targetAfterAccount;
    });
    emitAiCreditUpdate({
      type: 'ai.credits.allocated',
      accountId: updatedTarget.id,
      organizationId: updatedTarget.organizationId,
      userId: updatedTarget.userId,
    });
    return this.accountSummary(updatedTarget);
  }

  async setAllocation(actor: AuthenticatedUserLike, input: SetAllocationInput) {
    const targetAllocated = toBig(input.allocatedTokens);
    const source = await this.resolveSourceAccountForTarget(actor, input);
    const target = await this.resolveTargetAccount(actor, input, source.id);
    if (source.id === target.id) {
      throw new AppError('Source and target AI account must be different', 400);
    }
    const updatedTarget = await prisma.$transaction(async (tx) => {
      const sourceAccount = await tx.aiCreditAccount.findUnique({ where: { id: source.id } });
      const targetAccount = await tx.aiCreditAccount.findUnique({ where: { id: target.id } });
      if (!sourceAccount || !targetAccount) throw new AppError('AI credit account not found', 404);

      const minimumTarget = accountSpent(targetAccount);
      if (targetAllocated < minimumTarget) {
        throw new AppError(
          'Assigned AI credits cannot be lower than used, reserved, or child allocated credits',
          409,
          true,
          'AI_ALLOCATION_BELOW_SPENT',
          {
            targetAllocatedTokens: tokenNumber(targetAllocated),
            minimumRequiredTokens: tokenNumber(minimumTarget),
          },
        );
      }

      const parentChanged = targetAccount.parentAccountId !== sourceAccount.id;
      const delta = targetAllocated - targetAccount.allocatedTokens;
      if (delta === 0n && !parentChanged) return targetAccount;

      const sourceBefore = accountAvailable(sourceAccount);
      const sourceRequired = parentChanged ? targetAllocated : delta;
      if (sourceRequired > 0n && sourceBefore < sourceRequired) {
        const sourceAvailable = sourceBefore > 0n ? sourceBefore : 0n;
        throw new AppError(
          'Not enough AI credits available to allocate',
          409,
          true,
          'AI_CREDITS_ALLOCATION_INSUFFICIENT',
          {
            availableCredits: tokenNumber(sourceAvailable),
            requiredCredits: tokenNumber(sourceRequired),
            minimumTopUpCredits: tokenNumber(sourceRequired > sourceAvailable ? sourceRequired - sourceAvailable : 0n),
            deficitCredits: tokenNumber(accountDeficit(sourceAccount)),
          },
        );
      }

      if (parentChanged && targetAccount.parentAccountId) {
        const oldParentAccount = await tx.aiCreditAccount.findUnique({
          where: { id: targetAccount.parentAccountId },
          select: { childAllocatedTokens: true },
        });
        await tx.aiCreditAccount.update({
          where: { id: targetAccount.parentAccountId },
          data: {
            childAllocatedTokens: oldParentAccount
              ? subtractChildAllocation(oldParentAccount, targetAccount.allocatedTokens)
              : 0n,
          },
        });
      }
      const sourceAfterAccount = await tx.aiCreditAccount.update({
        where: { id: sourceAccount.id },
        data: { childAllocatedTokens: { increment: sourceRequired } },
      });
      const targetAfterAccount = await tx.aiCreditAccount.update({
        where: { id: targetAccount.id },
        data: {
          allocatedTokens: targetAllocated,
          parentAccountId: sourceAccount.id,
          status: targetAllocated > 0n ? AiCreditAccountStatus.ACTIVE : targetAccount.status,
        },
      });

      await tx.aiCreditLedgerEntry.createMany({
        data: [
          {
            accountId: sourceAccount.id,
            actorUserId: actor.userId,
            type: AiCreditLedgerType.ALLOCATION,
            amountMinor: 0,
            oldBalanceMinor: sourceAccount.balanceMinor,
            newBalanceMinor: sourceAccount.balanceMinor,
            amountTokens: -delta,
            oldTokenBalance: sourceBefore,
            newTokenBalance: accountAvailable(sourceAfterAccount),
            reason: input.reason ?? 'AI credit allocation update',
            referenceNote: input.referenceNote ?? null,
            metadata: jsonValue({
              targetAccountId: targetAccount.id,
              mode: 'set',
              previousAllocatedTokens: tokenNumber(targetAccount.allocatedTokens),
              nextAllocatedTokens: tokenNumber(targetAllocated),
            }),
          },
          {
            accountId: targetAccount.id,
            actorUserId: actor.userId,
            type: AiCreditLedgerType.ALLOCATION,
            amountMinor: 0,
            oldBalanceMinor: targetAccount.balanceMinor,
            newBalanceMinor: targetAccount.balanceMinor,
            amountTokens: delta,
            oldTokenBalance: accountAvailable(targetAccount),
            newTokenBalance: accountAvailable(targetAfterAccount),
            reason: input.reason ?? 'AI credit allocation update',
            referenceNote: input.referenceNote ?? null,
            metadata: jsonValue({
              sourceAccountId: sourceAccount.id,
              mode: 'set',
              previousAllocatedTokens: tokenNumber(targetAccount.allocatedTokens),
              nextAllocatedTokens: tokenNumber(targetAllocated),
            }),
          },
        ],
      });
      return targetAfterAccount;
    });
    emitAiCreditUpdate({
      type: 'ai.credits.allocated',
      accountId: updatedTarget.id,
      organizationId: updatedTarget.organizationId,
      userId: updatedTarget.userId,
    });
    return this.accountSummary(updatedTarget);
  }

  async proxyGeminiGenerate(actor: AuthenticatedUserLike, input: GeminiProxyInput) {
    this.assertAiUser(actor);
    const config = await this.ensureConfig();
    if (!config.enabled) throw new AppError('AI is not enabled by Super Admin', 503);
    const apiKey = tryDecryptSecret(config.geminiApiKeyEncrypted);
    if (!apiKey) throw new AppError('Master Gemini API key is not configured', 503);

    const account = await this.resolveUsageAccount(actor);
    const modelId = this.normalizeAllowedModel(input.modelId, config);
    const pricing = await this.pricingForModel(modelId);
    const operation = input.operation === 'predict' ? 'predict' : 'generateContent';
    const useGoogleSearch =
      Boolean(input.enableGoogleSearch) &&
      config.googleSearchGroundingEnabled &&
      operation === 'generateContent';
    const requestData = useGoogleSearch
      ? this.withGoogleSearch(input.data)
      : input.data;
    const reservation = await this.estimateReservationCredits(modelId, apiKey, requestData, pricing, {
      enableGoogleSearch: useGoogleSearch,
    });
    await this.reserveTokens(account.id, reservation.credits, actor, input.feature, {
      ...reservation,
      modelId,
    });

    try {
      const gemini = await this.postGemini(`${modelId}:${operation}`, apiKey, requestData);
      const responseSearchGroundingQueries = useGoogleSearch
        ? responseSearchGroundingCount(gemini)
        : 0;
      const actual = this.actualUsageCredits(gemini, pricing, reservation, {
        enableGoogleSearch: useGoogleSearch,
      });
      const committed = await this.commitUsage(account.id, reservation.credits, actual, actor, {
        feature: input.feature,
        modelId,
        responseSearchGroundingQueries,
      });
      return {
        gemini,
        usage: {
          reservedTokens: tokenNumber(reservation.credits),
          usedTokens: tokenNumber(committed.chargedCredits),
          reservedCredits: tokenNumber(reservation.credits),
          usedCredits: tokenNumber(committed.chargedCredits),
          actualCredits: tokenNumber(actual.credits),
          unbilledOverageCredits: tokenNumber(committed.unbilledOverageCredits),
          inputTokens: actual.inputTokens,
          outputTokens: actual.outputTokens,
          thinkingTokens: actual.thinkingTokens,
          totalTokens: actual.totalTokens,
          imageCount: actual.imageCount,
          searchGroundingCount: actual.searchGroundingCount,
          estimatedCostMicros: tokenNumber(actual.credits),
        },
        creditStatus: this.creditStatus(committed.account),
      };
    } catch (error) {
      const refunded = await this.refundReservation(account.id, reservation.credits, actor, input.feature);
      emitAiCreditUpdate({
        type: 'ai.usage.refunded',
        accountId: refunded.id,
        organizationId: refunded.organizationId,
        userId: refunded.userId,
      });
      throw error;
    }
  }

  private async ensureConfig() {
    return prisma.aiMasterConfig.upsert({
      where: { id: MASTER_CONFIG_ID },
      update: {},
      create: { id: MASTER_CONFIG_ID },
    });
  }

  private async ensureMasterAccount() {
    return prisma.aiCreditAccount.upsert({
      where: { id: MASTER_ACCOUNT_ID },
      update: {},
      create: {
        id: MASTER_ACCOUNT_ID,
        scope: AiCreditScope.MASTER,
        status: AiCreditAccountStatus.ACTIVE,
      },
    });
  }

  private async ensureOrganizationAccount(organizationId: string, parentAccountId?: string | null) {
    const existing = await prisma.aiCreditAccount.findFirst({
      where: { scope: AiCreditScope.ORGANIZATION, organizationId },
    });
    if (existing) return existing;
    return prisma.aiCreditAccount.create({
      data: {
        scope: AiCreditScope.ORGANIZATION,
        organizationId,
        parentAccountId: parentAccountId ?? MASTER_ACCOUNT_ID,
        status: AiCreditAccountStatus.ACTIVE,
      },
    });
  }

  private async ensureUserAccount(userId: string, organizationId: string | null, parentAccountId: string) {
    const existing = await prisma.aiCreditAccount.findFirst({
      where: { scope: AiCreditScope.USER, userId },
    });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.parentAccountId !== parentAccountId) {
        return prisma.aiCreditAccount.update({
          where: { id: existing.id },
          data: {
            organizationId,
            parentAccountId,
          },
        });
      }
      return existing;
    }
    return prisma.aiCreditAccount.create({
      data: {
        scope: AiCreditScope.USER,
        userId,
        organizationId,
        parentAccountId,
        status: AiCreditAccountStatus.ACTIVE,
      },
    });
  }

  private async resolveTargetAccount(actor: AuthenticatedUserLike, input: AiTargetAccountInput, parentAccountId: string) {
    if (input.scope === AiCreditScope.ORGANIZATION) {
      if (!input.organizationId) throw new AppError('organizationId is required', 400);
      await ensureOrganizationManaged(input.organizationId, actor);
      return this.ensureOrganizationAccount(input.organizationId, parentAccountId);
    }
    if (input.scope === AiCreditScope.USER) {
      if (!input.userId) throw new AppError('userId is required', 400);
      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      if (!user || user.deletedAt) throw new AppError('User not found', 404);
      if (!AI_USER_ROLES.has(user.role)) throw new AppError('This role cannot receive AI credits', 400);
      if (user.primaryOrganizationId) {
        await ensureOrganizationManaged(user.primaryOrganizationId, actor);
      }
      return this.ensureUserAccount(user.id, user.primaryOrganizationId, parentAccountId);
    }
    throw new AppError('Only organization and user AI allocations are supported', 400);
  }

  private async defaultSourceAccount(actor: AuthenticatedUserLike) {
    if (actor.role === UserRole.SUPER_ADMIN) return this.ensureMasterAccount();
    if (!actor.organizationId) throw new AppError('Admin organization is required for AI allocation', 400);
    await ensureOrganizationManaged(actor.organizationId, actor);
    return this.ensureOrganizationAccount(actor.organizationId, MASTER_ACCOUNT_ID);
  }

  private async resolveSourceAccountForTarget(
    actor: AuthenticatedUserLike,
    input: Pick<AllocationInput, 'sourceAccountId' | 'scope' | 'userId'>,
  ) {
    if (input.sourceAccountId) return this.getManagedAccount(actor, input.sourceAccountId);
    if (input.scope === AiCreditScope.USER && input.userId) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { primaryOrganizationId: true },
      });
      if (user?.primaryOrganizationId) {
        await ensureOrganizationManaged(user.primaryOrganizationId, actor);
        return this.ensureOrganizationAccount(user.primaryOrganizationId, MASTER_ACCOUNT_ID);
      }
    }
    return this.defaultSourceAccount(actor);
  }

  private async getManagedAccount(actor: AuthenticatedUserLike, accountId: string) {
    const account = await prisma.aiCreditAccount.findUnique({
      where: { id: accountId },
      include: { user: { select: { primaryOrganizationId: true } } },
    });
    if (!account) throw new AppError('AI credit account not found', 404);
    if (actor.role === UserRole.SUPER_ADMIN) return account;
    const managedIds = await getManagedOrganizationIds(actor);
    const accountOrgId = account.organizationId ?? account.user?.primaryOrganizationId ?? null;
    if (!accountOrgId || !managedIds?.includes(accountOrgId)) {
      throw new AppError('You do not have access to this AI credit account', 403);
    }
    return account;
  }

  private async resolveUsageAccount(actor: AuthenticatedUserLike) {
    if (actor.role === UserRole.SUPER_ADMIN && !actor.organizationId) {
      return this.ensureMasterAccount();
    }
    if (!actor.organizationId) throw new AppError('AI requires an organization context', 400);
    const userAccount = await prisma.aiCreditAccount.findFirst({
      where: {
        scope: AiCreditScope.USER,
        userId: actor.userId,
        status: { not: AiCreditAccountStatus.DISABLED },
      },
    });
    if (userAccount && userAccount.allocatedTokens > 0n) return userAccount;
    return this.ensureOrganizationAccount(actor.organizationId, MASTER_ACCOUNT_ID);
  }

  private async reserveTokens(
    accountId: string,
    amount: bigint,
    actor: AuthenticatedUserLike,
    feature?: string,
    estimate?: AiUsageEstimate & { modelId?: string },
  ) {
    await prisma.$transaction(async (tx) => {
      const account = await tx.aiCreditAccount.findUnique({ where: { id: accountId } });
      if (!account || account.status === AiCreditAccountStatus.DISABLED) {
        throw new AppError('AI credits are not available for this account', 402);
      }
      const before = accountAvailable(account);
      if (!account.unlimited && before < amount) {
        const available = before > 0n ? before : 0n;
        const deficit = accountDeficit(account);
        throw new AppError(
          'AI credits are low or exhausted. Please upgrade the credit.',
          402,
          true,
          'AI_CREDITS_INSUFFICIENT',
          {
            accountId,
            allocatedCredits: tokenNumber(account.allocatedTokens),
            usedCredits: tokenNumber(account.usedTokens),
            reservedCredits: tokenNumber(account.reservedTokens),
            childAllocatedCredits: tokenNumber(account.childAllocatedTokens),
            availableCredits: tokenNumber(available),
            requiredCredits: tokenNumber(amount),
            minimumTopUpCredits: tokenNumber(amount > available ? amount - available : 0n),
            deficitCredits: tokenNumber(deficit),
            feature,
            estimate: estimate
              ? {
                  inputTokens: estimate.inputTokens,
                  outputTokens: estimate.outputTokens,
                  thinkingTokens: estimate.thinkingTokens,
                  totalTokens: estimate.totalTokens,
                  imageCount: estimate.imageCount,
                  searchGroundingCount: estimate.searchGroundingCount,
                  estimatedCostMicros: tokenNumber(estimate.credits),
                  modelId: estimate.modelId,
                }
              : null,
          },
        );
      }
      const next = await tx.aiCreditAccount.update({
        where: { id: accountId },
        data: { reservedTokens: { increment: amount } },
      });
      await tx.aiCreditLedgerEntry.create({
        data: {
          accountId,
          actorUserId: actor.userId,
          type: AiCreditLedgerType.RESERVATION,
          amountMinor: 0,
          oldBalanceMinor: account.balanceMinor,
          newBalanceMinor: account.balanceMinor,
          amountTokens: amount,
          oldTokenBalance: before,
          newTokenBalance: accountAvailable(next),
          inputTokens: toBig(estimate?.inputTokens ?? 0),
          outputTokens: toBig(estimate?.outputTokens ?? 0),
          thinkingTokens: toBig(estimate?.thinkingTokens ?? 0),
          totalTokens: toBig(estimate?.totalTokens ?? 0),
          imageCount: estimate?.imageCount ?? 0,
          searchGroundingCount: estimate?.searchGroundingCount ?? 0,
          estimatedCostMicros: amount,
          modelId: estimate?.modelId ?? null,
          pricingSnapshot: jsonValue(estimate?.pricingSnapshot ?? {}),
          reason: 'AI request reservation',
          metadata: jsonValue({ feature }),
        },
      });
    });
  }

  private async commitUsage(
    accountId: string,
    reserved: bigint,
    usage: AiUsageEstimate,
    actor: AuthenticatedUserLike,
    metadata: Record<string, unknown>,
  ): Promise<{ account: AiCreditAccount; chargedCredits: bigint; unbilledOverageCredits: bigint }> {
    const committed = await prisma.$transaction(async (tx) => {
      const account = await tx.aiCreditAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new AppError('AI credit account not found', 404);
      const before = accountAvailable(account);
      const releasableAvailable = before + reserved;
      const chargeableCredits = account.unlimited
        ? usage.credits
        : usage.credits > releasableAvailable
          ? (releasableAvailable > 0n ? releasableAvailable : 0n)
          : usage.credits;
      const unbilledOverageCredits = usage.credits > chargeableCredits
        ? usage.credits - chargeableCredits
        : 0n;
      const next = await tx.aiCreditAccount.update({
        where: { id: accountId },
        data: {
          reservedTokens: { decrement: reserved },
          usedTokens: { increment: chargeableCredits },
        },
      });
      await tx.aiCreditLedgerEntry.create({
        data: {
          accountId,
          actorUserId: actor.userId,
          type: AiCreditLedgerType.USAGE_COMMIT,
          amountMinor: 0,
          oldBalanceMinor: account.balanceMinor,
          newBalanceMinor: account.balanceMinor,
          amountTokens: chargeableCredits,
          oldTokenBalance: before,
          newTokenBalance: accountAvailable(next),
          inputTokens: toBig(usage.inputTokens),
          outputTokens: toBig(usage.outputTokens),
          thinkingTokens: toBig(usage.thinkingTokens),
          totalTokens: toBig(usage.totalTokens),
          imageCount: usage.imageCount,
          searchGroundingCount: usage.searchGroundingCount,
          estimatedCostMicros: chargeableCredits,
          modelId: typeof metadata.modelId === 'string' ? metadata.modelId : null,
          pricingSnapshot: jsonValue(usage.pricingSnapshot),
          reason: 'AI credit usage',
          metadata: jsonValue({
            ...metadata,
            reservedTokens: tokenNumber(reserved),
            actualCredits: tokenNumber(usage.credits),
            chargedCredits: tokenNumber(chargeableCredits),
            unbilledOverageCredits: tokenNumber(unbilledOverageCredits),
          }),
        },
      });
      if (unbilledOverageCredits > 0n) {
        logger.warn('AI usage exceeded reserved/available credits; capped committed charge', {
          accountId,
          actorUserId: actor.userId,
          reservedCredits: tokenNumber(reserved),
          actualCredits: tokenNumber(usage.credits),
          chargedCredits: tokenNumber(chargeableCredits),
          unbilledOverageCredits: tokenNumber(unbilledOverageCredits),
        });
      }
      return {
        account: next,
        chargedCredits: chargeableCredits,
        unbilledOverageCredits,
      };
    });
    emitAiCreditUpdate({
      type: 'ai.usage.committed',
      accountId: committed.account.id,
      organizationId: committed.account.organizationId,
      userId: committed.account.userId,
      usedTokens: tokenNumber(committed.chargedCredits),
      usedCredits: tokenNumber(committed.chargedCredits),
    });
    return {
      account: committed.account,
      chargedCredits: committed.chargedCredits,
      unbilledOverageCredits: committed.unbilledOverageCredits,
    };
  }

  private async refundReservation(
    accountId: string,
    reserved: bigint,
    actor: AuthenticatedUserLike,
    feature?: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.aiCreditAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new AppError('AI credit account not found', 404);
      const before = accountAvailable(account);
      const next = await tx.aiCreditAccount.update({
        where: { id: accountId },
        data: { reservedTokens: { decrement: reserved } },
      });
      await tx.aiCreditLedgerEntry.create({
        data: {
          accountId,
          actorUserId: actor.userId,
          type: AiCreditLedgerType.RESERVATION_REFUND,
          amountMinor: 0,
          oldBalanceMinor: account.balanceMinor,
          newBalanceMinor: account.balanceMinor,
          amountTokens: -reserved,
          oldTokenBalance: before,
          newTokenBalance: accountAvailable(next),
          reason: 'AI request reservation refunded',
          metadata: jsonValue({ feature }),
        },
      });
      return next;
    });
  }

  private async estimateReservationCredits(
    modelId: string,
    apiKey: string,
    data: Record<string, unknown>,
    pricing: AiPricingRecord,
    options: { enableGoogleSearch: boolean },
  ): Promise<AiUsageEstimate> {
    const generationConfig = (data.generationConfig ?? {}) as Record<string, unknown>;
    const maxOutputTokensRaw = Number(generationConfig.maxOutputTokens ?? 4096);
    const maxOutputTokens = Number.isFinite(maxOutputTokensRaw)
      ? Math.max(256, Math.min(Math.trunc(maxOutputTokensRaw), 8192))
      : 4096;
    const imageCount = pricing.billingType === 'image' ? requestedImageCount(data) : 0;
    const searchGroundingCount = billableSearchGroundingCount(options.enableGoogleSearch);
    try {
      const count = await this.postGemini(`${modelId}:countTokens`, apiKey, {
        contents: data.contents,
        systemInstruction: data.systemInstruction,
        tools: data.tools,
      });
      const countedTokens = Number(count.totalTokens);
      const inputTokens = Number.isFinite(countedTokens) && countedTokens > 0
        ? Math.trunc(countedTokens)
        : 0;
      return calculateAiCredits(pricing, {
        inputTokens,
        outputTokens: pricing.billingType === 'image' ? 0 : maxOutputTokens,
        thinkingTokens: 0,
        totalTokens: inputTokens + (pricing.billingType === 'image' ? 0 : maxOutputTokens),
        imageCount,
        searchGroundingCount,
      });
    } catch {
      return calculateAiCredits(pricing, {
        inputTokens: pricing.billingType === 'image' ? 0 : 2048,
        outputTokens: pricing.billingType === 'image' ? 0 : maxOutputTokens,
        thinkingTokens: 0,
        totalTokens: pricing.billingType === 'image' ? 0 : maxOutputTokens + 2048,
        imageCount,
        searchGroundingCount,
      });
    }
  }

  private actualUsageCredits(
    response: Record<string, unknown>,
    pricing: AiPricingRecord,
    reservation: AiUsageEstimate,
    options: { enableGoogleSearch: boolean },
  ): AiUsageEstimate {
    const imageCount = pricing.billingType === 'image'
      ? responseImageCount(response) || reservation.imageCount
      : 0;
    const searchGroundingCount = billableSearchGroundingCount(options.enableGoogleSearch);
    const usage = extractGeminiUsageBreakdown(response, {
      imageCount,
      searchGroundingCount,
    });
    const hasUsageMetadata =
      usage.totalTokens > 0 ||
      usage.inputTokens > 0 ||
      usage.outputTokens > 0 ||
      usage.thinkingTokens > 0 ||
      usage.imageCount > 0 ||
      usage.searchGroundingCount > 0;
    if (!hasUsageMetadata) return reservation;
    const estimated = calculateAiCredits(pricing, usage);
    return estimated.credits > 0n ? estimated : reservation;
  }

  private async postGemini(path: string, apiKey: string, data: Record<string, unknown>) {
    const response = await fetch(`${GEMINI_API_BASE}/models/${path}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: unknown };
    };
    if (!response.ok) {
      const message =
        typeof payload?.error?.message === 'string'
          ? payload.error.message
          : `Gemini request failed (${response.status})`;
      throw new AppError(message, response.status >= 500 ? 502 : response.status);
    }
    return payload as Record<string, unknown>;
  }

  private normalizeAllowedModel(modelId: string, config: { geminiTextModel: string; geminiImageModel: string; geminiTtsModel: string }) {
    const requested = modelId.trim();
    const allowed = new Set([
      config.geminiTextModel,
      config.geminiImageModel,
      config.geminiTtsModel,
      'gemini-2.5-flash',
      'gemini-2.5-flash-image',
      'imagen-4.0-generate-001',
      'gemini-2.5-flash-preview-tts',
    ]);
    if (!requested) return config.geminiTextModel;
    if (!allowed.has(requested)) {
      throw new AppError('Selected Gemini model is not enabled in the AI module', 400);
    }
    return requested;
  }

  private withGoogleSearch(data: Record<string, unknown>): Record<string, unknown> {
    return {
      ...data,
      tools: [{ google_search: {} }],
    };
  }

  private async ensureDefaultPricing() {
    await prisma.$transaction(
      DEFAULT_AI_MODEL_PRICING.map((row) =>
        prisma.aiModelPricing.upsert({
          where: { modelId: row.modelId },
          update: {},
          create: {
            provider: row.provider ?? 'gemini',
            modelId: row.modelId,
            billingType: row.billingType,
            inputUsdMicrosPerMillion: row.inputUsdMicrosPerMillion,
            outputUsdMicrosPerMillion: row.outputUsdMicrosPerMillion,
            imageUsdMicrosEach: row.imageUsdMicrosEach,
            searchUsdMicrosPerThousand: row.searchUsdMicrosPerThousand,
            enabled: row.enabled ?? true,
          },
        }),
      ),
    );
  }

  private async pricingForModel(modelId: string): Promise<AiPricingRecord> {
    await this.ensureDefaultPricing();
    const pricing = await prisma.aiModelPricing.findUnique({ where: { modelId } });
    if (pricing?.enabled) return pricing;
    if (pricing && !pricing.enabled) {
      throw new AppError('AI pricing is disabled for the selected model', 400);
    }
    const fallback = DEFAULT_AI_MODEL_PRICING.find((row) => row.modelId === modelId);
    if (fallback) return fallback;
    throw new AppError('AI pricing is not configured for the selected model', 400);
  }

  private pricingSummary(pricing: AiPricingRecord & { id?: string; createdAt?: Date; updatedAt?: Date }) {
    return {
      id: pricing.id ?? pricing.modelId,
      provider: pricing.provider ?? 'gemini',
      modelId: pricing.modelId,
      billingType: pricing.billingType,
      inputUsdMicrosPerMillion: pricing.inputUsdMicrosPerMillion,
      outputUsdMicrosPerMillion: pricing.outputUsdMicrosPerMillion,
      imageUsdMicrosEach: pricing.imageUsdMicrosEach,
      searchUsdMicrosPerThousand: pricing.searchUsdMicrosPerThousand,
      enabled: pricing.enabled ?? true,
      createdAt: pricing.createdAt,
      updatedAt: pricing.updatedAt,
    };
  }

  private configSummary(config: Awaited<ReturnType<typeof prisma.aiMasterConfig.upsert>>) {
    return {
      id: config.id,
      provider: config.provider,
      enabled: config.enabled,
      hasGeminiApiKey: Boolean(config.geminiApiKeyEncrypted),
      maskedGeminiApiKey: maskKey(config.geminiApiKeyLast4),
      geminiTextModel: config.geminiTextModel,
      geminiImageModel: config.geminiImageModel,
      geminiTtsModel: config.geminiTtsModel,
      googleSearchGroundingEnabled: config.googleSearchGroundingEnabled,
      lastTestedAt: config.lastTestedAt,
      lastTestStatus: config.lastTestStatus,
      lastTestMessage: config.lastTestMessage,
      updatedAt: config.updatedAt,
    };
  }

  private accountSummary(account: AiCreditAccount & Record<string, unknown>) {
    const available = accountAvailable(account);
    const allocated = account.allocatedTokens;
    return {
      id: account.id,
      scope: account.scope,
      parentAccountId: account.parentAccountId,
      organizationId: account.organizationId,
      userId: account.userId,
      allocatedTokens: tokenNumber(account.allocatedTokens),
      usedTokens: tokenNumber(account.usedTokens),
      reservedTokens: tokenNumber(account.reservedTokens),
      childAllocatedTokens: tokenNumber(account.childAllocatedTokens),
      availableTokens: tokenNumber(available > 0n ? available : 0n),
      percentRemaining:
        allocated > 0n ? Number((available > 0n ? available * 10000n : 0n) / allocated) / 100 : 0,
      warningLevel: warningLevelFor(available, allocated),
      unlimited: account.unlimited,
      status: account.status,
      organization: account.organization,
      user: account.user,
      parentAccount: account.parentAccount,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private creditStatus(account: AiCreditAccount) {
    const available = accountAvailable(account);
    return {
      accountId: account.id,
      scope: account.scope,
      organizationId: account.organizationId,
      userId: account.userId,
      availableTokens: tokenNumber(available > 0n ? available : 0n),
      allocatedTokens: tokenNumber(account.allocatedTokens),
      usedTokens: tokenNumber(account.usedTokens),
      reservedTokens: tokenNumber(account.reservedTokens),
      percentRemaining:
        account.allocatedTokens > 0n
          ? Number((available > 0n ? available * 10000n : 0n) / account.allocatedTokens) / 100
          : 0,
      warningLevel: warningLevelFor(available, account.allocatedTokens),
    };
  }

  private async reconcileUserAccountParents() {
    const userAccounts = await prisma.aiCreditAccount.findMany({
      where: {
        scope: AiCreditScope.USER,
        user: { primaryOrganizationId: { not: null } },
      },
      include: {
        user: { select: { primaryOrganizationId: true } },
      },
    });
    for (const userAccount of userAccounts) {
      const organizationId = userAccount.user?.primaryOrganizationId;
      if (!organizationId) continue;
      const organizationAccount = await this.ensureOrganizationAccount(organizationId, MASTER_ACCOUNT_ID);
      if (
        userAccount.parentAccountId === organizationAccount.id &&
        userAccount.organizationId === organizationId
      ) {
        continue;
      }
      await prisma.$transaction(async (tx) => {
        if (userAccount.parentAccountId) {
          const oldParentAccount = await tx.aiCreditAccount.findUnique({
            where: { id: userAccount.parentAccountId },
            select: { childAllocatedTokens: true },
          });
          await tx.aiCreditAccount.update({
            where: { id: userAccount.parentAccountId },
            data: {
              childAllocatedTokens: oldParentAccount
                ? subtractChildAllocation(oldParentAccount, userAccount.allocatedTokens)
                : 0n,
            },
          }).catch(() => null);
        }
        await tx.aiCreditAccount.update({
          where: { id: organizationAccount.id },
          data: { childAllocatedTokens: { increment: userAccount.allocatedTokens } },
        });
        await tx.aiCreditAccount.update({
          where: { id: userAccount.id },
          data: {
            parentAccountId: organizationAccount.id,
            organizationId,
          },
        });
      });
    }
  }

  private assertSuperAdmin(actor: AuthenticatedUserLike) {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('Only SoftLogic Super Admin can manage master AI settings', 403);
    }
  }

  private assertAiUser(actor: AuthenticatedUserLike) {
    if (!AI_USER_ROLES.has(actor.role)) {
      throw new AppError('Students and parents cannot use AI tools', 403);
    }
  }

  private normalizeFeatureKey(featureKey: string | undefined): string {
    const normalized = featureKey?.trim() || TEXT_TO_MEDIA_FEATURE;
    if (normalized !== TEXT_TO_MEDIA_FEATURE) {
      throw new AppError('Unsupported AI feature limit', 400);
    }
    return normalized;
  }

  private async updateOwnFeatureAttempt(
    actor: AuthenticatedUserLike,
    input: AiFeatureAttemptInput,
    status: AiFeatureUsageAttemptStatus,
  ) {
    const attemptId = input.attemptId?.trim();
    if (!attemptId) {
      throw new AppError('attemptId is required', 400);
    }
    const attempt = await prisma.aiFeatureUsageAttempt.findFirst({
      where: {
        id: attemptId,
        userId: actor.userId,
        featureKey: this.normalizeFeatureKey(input.featureKey),
      },
    });
    if (!attempt) {
      throw new AppError('AI feature attempt was not found', 404);
    }
    if (attempt.status !== AiFeatureUsageAttemptStatus.RESERVED) {
      return attempt;
    }
    const existingMetadata =
      attempt.metadata && typeof attempt.metadata === 'object' && !Array.isArray(attempt.metadata)
        ? (attempt.metadata as Record<string, unknown>)
        : {};
    return prisma.aiFeatureUsageAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        metadata: jsonValue({ ...existingMetadata, ...(input.metadata ?? {}) }),
      },
    });
  }

  private async featureAttemptsUsed(userId: string, featureKey: string): Promise<number> {
    return prisma.aiFeatureUsageAttempt.count({
      where: {
        userId,
        featureKey,
        status: {
          in: [
            AiFeatureUsageAttemptStatus.RESERVED,
            AiFeatureUsageAttemptStatus.COMMITTED,
          ],
        },
        createdAt: { gte: new Date(Date.now() - TEXT_TO_MEDIA_WINDOW_MS) },
      },
    });
  }

  private featureAttemptSummary(
    attempt: {
      id: string;
      featureKey: string;
      status: AiFeatureUsageAttemptStatus;
      createdAt: Date;
      updatedAt: Date;
    },
    usedInWindow: number,
  ) {
    return {
      attemptId: attempt.id,
      featureKey: attempt.featureKey,
      status: attempt.status,
      limit: TEXT_TO_MEDIA_LIMIT,
      usedInWindow,
      remainingInWindow: Math.max(0, TEXT_TO_MEDIA_LIMIT - usedInWindow),
      windowHours: TEXT_TO_MEDIA_WINDOW_MS / (60 * 60 * 1000),
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    };
  }

  private async reconcileOverdrawnUsageAccounts() {
    const accounts = await prisma.aiCreditAccount.findMany({
      where: {
        unlimited: false,
        status: { not: AiCreditAccountStatus.DISABLED },
        usedTokens: { gt: 0 },
      },
      take: 1000,
    });

    for (const account of accounts) {
      const deficit = accountDeficit(account);
      if (deficit <= 0n || account.usedTokens <= 0n) continue;
      const adjustment = deficit > account.usedTokens ? account.usedTokens : deficit;
      if (adjustment <= 0n) continue;

      await prisma.$transaction(async (tx) => {
        const latest = await tx.aiCreditAccount.findUnique({ where: { id: account.id } });
        if (!latest) return;
        const latestDeficit = accountDeficit(latest);
        if (latestDeficit <= 0n || latest.usedTokens <= 0n) return;
        const latestAdjustment = latestDeficit > latest.usedTokens ? latest.usedTokens : latestDeficit;
        const before = accountAvailable(latest);
        const next = await tx.aiCreditAccount.update({
          where: { id: latest.id },
          data: { usedTokens: { decrement: latestAdjustment } },
        });
        await tx.aiCreditLedgerEntry.create({
          data: {
            accountId: latest.id,
            actorUserId: null,
            type: AiCreditLedgerType.ADJUSTMENT,
            amountMinor: 0,
            oldBalanceMinor: latest.balanceMinor,
            newBalanceMinor: latest.balanceMinor,
            amountTokens: -latestAdjustment,
            oldTokenBalance: before,
            newTokenBalance: accountAvailable(next),
            reason: 'AI credit overdraw reconciliation',
            metadata: jsonValue({
              mode: 'overdraw_reconciliation',
              previousUsedTokens: tokenNumber(latest.usedTokens),
              adjustedUsedTokens: tokenNumber(next.usedTokens),
              correctedDeficitCredits: tokenNumber(latestAdjustment),
            }),
          },
        });
      });
    }
  }
}

export const aiService = new AiService();
