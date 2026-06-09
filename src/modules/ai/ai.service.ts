import { createHash } from 'crypto';
import {
  AiCreditAccount,
  AiCreditAccountStatus,
  AiCreditLedgerType,
  AiCreditScope,
  Prisma,
  UserRole,
} from '@prisma/client';

import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import {
  AuthenticatedUserLike,
  ensureOrganizationManaged,
  getManagedOrganizationIds,
} from '@/shared/utils/access-control';
import { decryptSecret, encryptSecret, tryDecryptSecret } from '@/shared/utils/cipher';
import { emitAiCreditUpdate } from './ai.realtime';

const MASTER_ACCOUNT_ID = 'master';
const MASTER_CONFIG_ID = 'master';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
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
  enabled?: boolean;
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

    const [accounts, organizations, users, recentLedger] = await Promise.all([
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
    ]);

    return {
      generatedAt: new Date().toISOString(),
      scope: {
        type: managedOrganizationIds === null ? 'GLOBAL' : 'MANAGED',
        organizationIds: managedOrganizationIds,
      },
      config: this.configSummary(config),
      master: this.accountSummary(masterAccount),
      accounts: accounts.map((account) => this.accountSummary(account)),
      organizations,
      users,
      recentLedger: recentLedger.map((entry) => ({
        ...entry,
        amountTokens: tokenNumber(entry.amountTokens),
        oldTokenBalance: tokenNumber(entry.oldTokenBalance),
        newTokenBalance: tokenNumber(entry.newTokenBalance),
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
    const updated = await prisma.$transaction(async (tx) => {
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
          reason: input.reason ?? 'AI token top-up',
          referenceNote: input.referenceNote ?? null,
        },
      });
      return next;
    });
    emitAiCreditUpdate({ type: 'ai.credits.top_up', accountId: updated.id });
    return this.accountSummary(updated);
  }

  async allocate(actor: AuthenticatedUserLike, input: AllocationInput) {
    const amount = toBig(input.amountTokens);
    const source = input.sourceAccountId
      ? await this.getManagedAccount(actor, input.sourceAccountId)
      : await this.defaultSourceAccount(actor);
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
        throw new AppError('Not enough AI tokens available to allocate', 409);
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
            reason: input.reason ?? 'AI token allocation',
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
            reason: input.reason ?? 'AI token allocation',
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

  async proxyGeminiGenerate(actor: AuthenticatedUserLike, input: GeminiProxyInput) {
    if (!AI_USER_ROLES.has(actor.role)) {
      throw new AppError('Students and parents cannot use AI tools', 403);
    }
    const config = await this.ensureConfig();
    if (!config.enabled) throw new AppError('AI is not enabled by Super Admin', 503);
    const apiKey = tryDecryptSecret(config.geminiApiKeyEncrypted);
    if (!apiKey) throw new AppError('Master Gemini API key is not configured', 503);

    const account = await this.resolveUsageAccount(actor);
    const modelId = this.normalizeAllowedModel(input.modelId, config);
    const operation = input.operation === 'predict' ? 'predict' : 'generateContent';
    const requestData = input.enableGoogleSearch && operation === 'generateContent'
      ? this.withGoogleSearch(input.data)
      : input.data;
    const reserveTokens = await this.estimateReservationTokens(modelId, apiKey, requestData);
    await this.reserveTokens(account.id, reserveTokens, actor, input.feature);

    try {
      const gemini = await this.postGemini(`${modelId}:${operation}`, apiKey, requestData);
      const used = toBig(this.extractUsageTokens(gemini) || reserveTokens);
      const finalAccount = await this.commitUsage(account.id, reserveTokens, used, actor, {
        feature: input.feature,
        modelId,
      });
      return {
        gemini,
        usage: {
          reservedTokens: tokenNumber(reserveTokens),
          usedTokens: tokenNumber(used),
        },
        creditStatus: this.creditStatus(finalAccount),
      };
    } catch (error) {
      const refunded = await this.refundReservation(account.id, reserveTokens, actor, input.feature);
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
    if (existing) return existing;
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

  private async resolveTargetAccount(actor: AuthenticatedUserLike, input: AllocationInput, parentAccountId: string) {
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
  ) {
    await prisma.$transaction(async (tx) => {
      const account = await tx.aiCreditAccount.findUnique({ where: { id: accountId } });
      if (!account || account.status === AiCreditAccountStatus.DISABLED) {
        throw new AppError('AI credits are not available for this account', 402);
      }
      if (!account.unlimited && accountAvailable(account) < amount) {
        throw new AppError('AI credits are low or exhausted. Please upgrade the credit.', 402);
      }
      const before = accountAvailable(account);
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
          reason: 'AI request reservation',
          metadata: jsonValue({ feature }),
        },
      });
    });
  }

  private async commitUsage(
    accountId: string,
    reserved: bigint,
    used: bigint,
    actor: AuthenticatedUserLike,
    metadata: Record<string, unknown>,
  ) {
    const updated = await prisma.$transaction(async (tx) => {
      const account = await tx.aiCreditAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new AppError('AI credit account not found', 404);
      const before = accountAvailable(account);
      const next = await tx.aiCreditAccount.update({
        where: { id: accountId },
        data: {
          reservedTokens: { decrement: reserved },
          usedTokens: { increment: used },
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
          amountTokens: used,
          oldTokenBalance: before,
          newTokenBalance: accountAvailable(next),
          reason: 'AI token usage',
          metadata: jsonValue({ ...metadata, reservedTokens: tokenNumber(reserved) }),
        },
      });
      return next;
    });
    emitAiCreditUpdate({
      type: 'ai.usage.committed',
      accountId: updated.id,
      organizationId: updated.organizationId,
      userId: updated.userId,
      usedTokens: tokenNumber(used),
    });
    return updated;
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

  private async estimateReservationTokens(modelId: string, apiKey: string, data: Record<string, unknown>): Promise<bigint> {
    const generationConfig = (data.generationConfig ?? {}) as Record<string, unknown>;
    const maxOutputTokensRaw = Number(generationConfig.maxOutputTokens ?? 4096);
    const maxOutputTokens = Number.isFinite(maxOutputTokensRaw)
      ? Math.max(256, Math.min(Math.trunc(maxOutputTokensRaw), 8192))
      : 4096;
    try {
      const count = await this.postGemini(`${modelId}:countTokens`, apiKey, {
        contents: data.contents,
        systemInstruction: data.systemInstruction,
        tools: data.tools,
      });
      return toBig(Number(count.totalTokens ?? 0) + maxOutputTokens);
    } catch {
      return toBig(maxOutputTokens + 2048);
    }
  }

  private extractUsageTokens(response: Record<string, unknown>): number | null {
    const usage = (response.usageMetadata ?? response.usage_metadata) as Record<string, unknown> | undefined;
    const total = Number(usage?.totalTokenCount ?? usage?.total_token_count);
    return Number.isFinite(total) && total > 0 ? Math.trunc(total) : null;
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

  private assertSuperAdmin(actor: AuthenticatedUserLike) {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new AppError('Only SoftLogic Super Admin can manage master AI settings', 403);
    }
  }
}

export const aiService = new AiService();
