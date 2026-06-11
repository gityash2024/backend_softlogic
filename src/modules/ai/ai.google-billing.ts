import { BigQuery } from '@google-cloud/bigquery';
import { AiCreditLedgerType, Prisma } from '@prisma/client';

import { env, prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { logger } from '@/shared/middleware/logger.middleware';

const CONFIG_ID = 'default';
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

export type GoogleBillingConfigInput = {
  enabled?: boolean;
  projectId?: string;
  billingTableProjectId?: string | null;
  billingDatasetId?: string | null;
  billingTableName?: string | null;
  monthlyCapMicros?: number;
};

type EffectiveGoogleBillingConfig = {
  id: string;
  enabled: boolean;
  projectId: string;
  billingTableProjectId: string | null;
  billingDatasetId: string | null;
  billingTableName: string | null;
  monthlyCapMicros: bigint;
  currency: string;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  updatedAt: Date;
};

type BillingQueryRow = {
  usageDate: { value?: string } | string;
  projectId: string;
  serviceDescription: string;
  skuDescription: string;
  currency: string;
  cost?: number | string | null;
  credits?: number | string | null;
  netCost?: number | string | null;
  usageAmount?: number | string | null;
  usageUnit?: string | null;
};

export type GoogleBillingSummary = {
  config: ReturnType<typeof publicConfig>;
  connected: boolean;
  status: 'DISABLED' | 'NEEDS_CONFIGURATION' | 'READY' | 'SUCCESS' | 'ERROR';
  message: string | null;
  lastSyncAt: string | null;
  googleCurrentMonthCostMicros: number;
  googleGrossCostMicros: number;
  googleCreditsMicros: number;
  softlogicCurrentMonthCostMicros: number;
  varianceMicros: number;
  monthlyCapMicros: number;
  remainingBudgetMicros: number;
  recentRows: Array<{
    id: string;
    usageDate: string;
    serviceDescription: string;
    skuDescription: string;
    costMicros: number;
    creditsMicros: number;
    netCostMicros: number;
    currency: string;
    usageAmount: number | null;
    usageUnit: string | null;
  }>;
  recentRuns: Array<{
    id: string;
    status: string;
    month: string;
    googleSpendMicros: number;
    softlogicSpendMicros: number;
    varianceMicros: number;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
};

const publicConfig = (config: EffectiveGoogleBillingConfig) => ({
  enabled: config.enabled,
  projectId: config.projectId,
  billingTableProjectId: config.billingTableProjectId,
  billingDatasetId: config.billingDatasetId,
  billingTableName: config.billingTableName,
  monthlyCapMicros: Number(config.monthlyCapMicros),
  currency: config.currency,
  lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
  lastSyncStatus: config.lastSyncStatus,
  lastSyncMessage: config.lastSyncMessage,
  updatedAt: config.updatedAt.toISOString(),
});

const monthKey = (date = new Date()): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const monthStart = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const nextMonthStart = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

const toMicros = (usd: number | string | null | undefined): bigint => {
  const value = Number(usd ?? 0);
  if (!Number.isFinite(value)) return 0n;
  return BigInt(Math.round(value * 1_000_000));
};

const numberFromBigInt = (value: bigint | number | null | undefined): number =>
  Number(value ?? 0);

const tableRef = (config: EffectiveGoogleBillingConfig): string | null => {
  if (!config.billingDatasetId || !config.billingTableName) return null;
  const tableProject = config.billingTableProjectId || config.projectId;
  return `${tableProject}.${config.billingDatasetId}.${config.billingTableName}`;
};

const quoteTable = (table: string): string => `\`${table.replace(/`/g, '')}\``;

export const buildGoogleBillingQuery = (table: string): string => `
SELECT
  DATE(usage_start_time) AS usageDate,
  project.id AS projectId,
  service.description AS serviceDescription,
  sku.description AS skuDescription,
  ANY_VALUE(currency) AS currency,
  SUM(cost) AS cost,
  SUM(IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS credits,
  SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS netCost,
  SUM(IFNULL(usage.amount, 0)) AS usageAmount,
  ANY_VALUE(usage.unit) AS usageUnit
FROM ${quoteTable(table)}
WHERE usage_start_time >= @startDate
  AND usage_start_time < @endDate
  AND project.id = @projectId
  AND (
    LOWER(service.description) LIKE '%gemini%'
    OR LOWER(service.description) LIKE '%generative%'
    OR LOWER(service.description) LIKE '%vertex ai%'
    OR LOWER(sku.description) LIKE '%gemini%'
    OR LOWER(sku.description) LIKE '%generative%'
    OR LOWER(sku.description) LIKE '%imagen%'
    OR LOWER(sku.description) LIKE '%vertex ai%'
  )
GROUP BY usageDate, projectId, serviceDescription, skuDescription
ORDER BY usageDate DESC, netCost DESC
`;

class AiGoogleBillingService {
  async summary(): Promise<GoogleBillingSummary> {
    const config = await this.effectiveConfig();
    return this.buildSummary(config);
  }

  async updateConfig(input: GoogleBillingConfigInput): Promise<GoogleBillingSummary> {
    const current = await this.ensureConfig();
    const updated = await prisma.aiGoogleBillingConfig.update({
      where: { id: CONFIG_ID },
      data: {
        enabled: input.enabled ?? current.enabled,
        projectId: input.projectId?.trim() || current.projectId,
        billingTableProjectId:
          input.billingTableProjectId === undefined
            ? current.billingTableProjectId
            : input.billingTableProjectId?.trim() || null,
        billingDatasetId:
          input.billingDatasetId === undefined
            ? current.billingDatasetId
            : input.billingDatasetId?.trim() || null,
        billingTableName:
          input.billingTableName === undefined
            ? current.billingTableName
            : input.billingTableName?.trim() || null,
        monthlyCapMicros:
          input.monthlyCapMicros === undefined
            ? current.monthlyCapMicros
            : BigInt(Math.max(1, Math.trunc(input.monthlyCapMicros))),
      },
    });
    return this.buildSummary(this.withEnv(updated));
  }

  async syncNow(): Promise<GoogleBillingSummary> {
    const config = await this.effectiveConfig();
    if (!config.enabled) {
      await this.markConfig('DISABLED', 'Google billing verification is disabled.');
      return this.buildSummary(await this.effectiveConfig());
    }

    const billingTable = tableRef(config);
    if (!billingTable || !env.GOOGLE_BILLING_SERVICE_ACCOUNT_PATH) {
      await this.markConfig(
        'NEEDS_CONFIGURATION',
        'Add the BigQuery billing export table and server service account path.',
      );
      return this.buildSummary(await this.effectiveConfig());
    }

    const month = monthKey();
    const run = await prisma.aiGoogleBillingSyncRun.create({
      data: {
        status: 'RUNNING',
        month,
        projectId: config.projectId,
        billingTable,
      },
    });

    try {
      const rows = await this.queryBigQuery(config, billingTable);
      const softlogicSpendMicros = await this.softlogicSpendMicros();
      const totals = await this.persistRows(rows, config, month);
      const varianceMicros = softlogicSpendMicros - totals.netCostMicros;
      const syncMessage = rows.length > 0
        ? `Synced ${rows.length} Google billing rows.`
        : 'Google billing sync succeeded, but BigQuery has not exported matching Gemini/AI rows for this month yet.';

      await prisma.$transaction([
        prisma.aiGoogleBillingSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            googleSpendMicros: totals.netCostMicros,
            softlogicSpendMicros,
            varianceMicros,
            completedAt: new Date(),
          },
        }),
        prisma.aiGoogleBillingConfig.update({
          where: { id: CONFIG_ID },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: 'SUCCESS',
            lastSyncMessage: syncMessage,
          },
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google billing sync failed';
      await prisma.$transaction([
        prisma.aiGoogleBillingSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'ERROR',
            errorMessage: message,
            completedAt: new Date(),
          },
        }),
        prisma.aiGoogleBillingConfig.update({
          where: { id: CONFIG_ID },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: 'ERROR',
            lastSyncMessage: message,
          },
        }),
      ]);
      throw new AppError(`Google billing sync failed: ${message}`, 502);
    }

    return this.buildSummary(await this.effectiveConfig());
  }

  startScheduler(): () => void {
    if (!env.GOOGLE_BILLING_SYNC_ENABLED) return () => undefined;
    const run = () => {
      this.syncNow().catch((error) => {
        logger.warn('Google billing verification sync failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    };
    const timeout = setTimeout(run, 15_000);
    const interval = setInterval(run, SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }

  private async ensureConfig() {
    return prisma.aiGoogleBillingConfig.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        enabled: env.GOOGLE_BILLING_SYNC_ENABLED,
        projectId: env.GOOGLE_BILLING_PROJECT_ID,
        billingTableProjectId: env.GOOGLE_BILLING_TABLE_PROJECT_ID,
        billingDatasetId: env.GOOGLE_BILLING_DATASET_ID,
        billingTableName: env.GOOGLE_BILLING_TABLE_NAME,
        monthlyCapMicros: BigInt(env.GOOGLE_BILLING_MONTHLY_CAP_MICROS),
      },
      update: {},
    });
  }

  private async effectiveConfig(): Promise<EffectiveGoogleBillingConfig> {
    const config = await this.ensureConfig();
    return this.withEnv(config);
  }

  private withEnv(config: Awaited<ReturnType<typeof prisma.aiGoogleBillingConfig.upsert>>): EffectiveGoogleBillingConfig {
    return {
      id: config.id,
      enabled: config.enabled || env.GOOGLE_BILLING_SYNC_ENABLED,
      projectId: config.projectId || env.GOOGLE_BILLING_PROJECT_ID,
      billingTableProjectId: config.billingTableProjectId || env.GOOGLE_BILLING_TABLE_PROJECT_ID || null,
      billingDatasetId: config.billingDatasetId || env.GOOGLE_BILLING_DATASET_ID || null,
      billingTableName: config.billingTableName || env.GOOGLE_BILLING_TABLE_NAME || null,
      monthlyCapMicros: config.monthlyCapMicros || BigInt(env.GOOGLE_BILLING_MONTHLY_CAP_MICROS),
      currency: config.currency,
      lastSyncAt: config.lastSyncAt,
      lastSyncStatus: config.lastSyncStatus,
      lastSyncMessage: config.lastSyncMessage,
      updatedAt: config.updatedAt,
    };
  }

  private async buildSummary(config: EffectiveGoogleBillingConfig): Promise<GoogleBillingSummary> {
    const month = monthKey();
    const [aggregate, rows, runs, softlogicCurrentMonthCostMicros] = await Promise.all([
      prisma.aiGoogleBillingDailyCost.aggregate({
        where: { month, projectId: config.projectId },
        _sum: {
          costMicros: true,
          creditsMicros: true,
          netCostMicros: true,
        },
      }),
      prisma.aiGoogleBillingDailyCost.findMany({
        where: { month, projectId: config.projectId },
        orderBy: [{ usageDate: 'desc' }, { netCostMicros: 'desc' }],
        take: 10,
      }),
      prisma.aiGoogleBillingSyncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
      this.softlogicSpendMicros(),
    ]);

    const googleCurrentMonthCostMicros = aggregate._sum.netCostMicros ?? 0n;
    const varianceMicros = softlogicCurrentMonthCostMicros - googleCurrentMonthCostMicros;
    const status = this.summaryStatus(config);
    return {
      config: publicConfig(config),
      connected: config.lastSyncStatus === 'SUCCESS',
      status,
      message: config.lastSyncMessage,
      lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
      googleCurrentMonthCostMicros: numberFromBigInt(googleCurrentMonthCostMicros),
      googleGrossCostMicros: numberFromBigInt(aggregate._sum.costMicros),
      googleCreditsMicros: numberFromBigInt(aggregate._sum.creditsMicros),
      softlogicCurrentMonthCostMicros: numberFromBigInt(softlogicCurrentMonthCostMicros),
      varianceMicros: numberFromBigInt(varianceMicros),
      monthlyCapMicros: numberFromBigInt(config.monthlyCapMicros),
      remainingBudgetMicros: numberFromBigInt(config.monthlyCapMicros - googleCurrentMonthCostMicros),
      recentRows: rows.map((row) => ({
        id: row.id,
        usageDate: row.usageDate.toISOString(),
        serviceDescription: row.serviceDescription,
        skuDescription: row.skuDescription,
        costMicros: numberFromBigInt(row.costMicros),
        creditsMicros: numberFromBigInt(row.creditsMicros),
        netCostMicros: numberFromBigInt(row.netCostMicros),
        currency: row.currency,
        usageAmount: row.usageAmount,
        usageUnit: row.usageUnit,
      })),
      recentRuns: runs.map((run) => ({
        id: run.id,
        status: run.status,
        month: run.month,
        googleSpendMicros: numberFromBigInt(run.googleSpendMicros),
        softlogicSpendMicros: numberFromBigInt(run.softlogicSpendMicros),
        varianceMicros: numberFromBigInt(run.varianceMicros),
        errorMessage: run.errorMessage,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      })),
    };
  }

  private summaryStatus(config: EffectiveGoogleBillingConfig): GoogleBillingSummary['status'] {
    if (!config.enabled) return 'DISABLED';
    if (!tableRef(config) || !env.GOOGLE_BILLING_SERVICE_ACCOUNT_PATH) return 'NEEDS_CONFIGURATION';
    if (config.lastSyncStatus === 'SUCCESS') return 'SUCCESS';
    if (config.lastSyncStatus === 'ERROR') return 'ERROR';
    return 'READY';
  }

  private async queryBigQuery(
    config: EffectiveGoogleBillingConfig,
    billingTable: string,
  ): Promise<BillingQueryRow[]> {
    const client = new BigQuery({
      projectId: config.projectId,
      keyFilename: env.GOOGLE_BILLING_SERVICE_ACCOUNT_PATH,
    });
    const [rows] = await client.query({
      query: buildGoogleBillingQuery(billingTable),
      params: {
        startDate: monthStart().toISOString(),
        endDate: nextMonthStart().toISOString(),
        projectId: config.projectId,
      },
    });
    return rows as BillingQueryRow[];
  }

  private async persistRows(
    rows: BillingQueryRow[],
    config: EffectiveGoogleBillingConfig,
    month: string,
  ): Promise<{ costMicros: bigint; creditsMicros: bigint; netCostMicros: bigint }> {
    let costMicros = 0n;
    let creditsMicros = 0n;
    let netCostMicros = 0n;

    const operations = rows.map((row) => {
        const rowCostMicros = toMicros(row.cost);
        const rowCreditsMicros = toMicros(row.credits);
        const rowNetCostMicros = toMicros(row.netCost);
        costMicros += rowCostMicros;
        creditsMicros += rowCreditsMicros;
        netCostMicros += rowNetCostMicros;
        const usageDateValue =
          typeof row.usageDate === 'string' ? row.usageDate : row.usageDate.value;
        const usageDate = new Date(`${usageDateValue}T00:00:00.000Z`);
        const data = {
          usageDate,
          month,
          projectId: row.projectId || config.projectId,
          serviceDescription: row.serviceDescription || 'Unknown service',
          skuDescription: row.skuDescription || 'Unknown SKU',
          costMicros: rowCostMicros,
          creditsMicros: rowCreditsMicros,
          netCostMicros: rowNetCostMicros,
          currency: row.currency || config.currency,
          usageAmount:
            row.usageAmount === null || row.usageAmount === undefined
              ? null
              : Number(row.usageAmount),
          usageUnit: row.usageUnit ?? null,
        };
        return prisma.aiGoogleBillingDailyCost.upsert({
          where: {
            usageDate_projectId_serviceDescription_skuDescription: {
              usageDate: data.usageDate,
              projectId: data.projectId,
              serviceDescription: data.serviceDescription,
              skuDescription: data.skuDescription,
            },
          },
          update: data,
          create: data,
        });
      });
    if (operations.length > 0) {
      await prisma.$transaction(operations);
    }

    return { costMicros, creditsMicros, netCostMicros };
  }

  private async softlogicSpendMicros(): Promise<bigint> {
    const aggregate = await prisma.aiCreditLedgerEntry.aggregate({
      where: {
        type: AiCreditLedgerType.USAGE_COMMIT,
        createdAt: {
          gte: monthStart(),
          lt: nextMonthStart(),
        },
      },
      _sum: { estimatedCostMicros: true },
    });
    return aggregate._sum.estimatedCostMicros ?? 0n;
  }

  private async markConfig(status: string, message: string): Promise<void> {
    await prisma.aiGoogleBillingConfig.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        enabled: env.GOOGLE_BILLING_SYNC_ENABLED,
        projectId: env.GOOGLE_BILLING_PROJECT_ID,
        monthlyCapMicros: BigInt(env.GOOGLE_BILLING_MONTHLY_CAP_MICROS),
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncMessage: message,
      },
      update: {
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncMessage: message,
      },
    });
  }
}

export const aiGoogleBillingService = new AiGoogleBillingService();
export const startAiGoogleBillingScheduler = (): (() => void) =>
  aiGoogleBillingService.startScheduler();
