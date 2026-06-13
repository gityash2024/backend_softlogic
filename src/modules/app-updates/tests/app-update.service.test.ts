import {
  AppReleaseBrand,
  AppReleaseEnvironment,
  AppReleasePlatform,
  UserRole,
} from '@prisma/client';
import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { appUpdateService } from '../app-update.service';

jest.mock('@/config', () => ({
  prisma: {
    appRelease: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
    adminAuditLog: {
      create: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const appReleaseMock = mockedPrisma.appRelease as unknown as {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  upsert: jest.Mock;
};
const transactionMock = mockedPrisma.$transaction as unknown as jest.Mock;

const release = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  environment: AppReleaseEnvironment.PRODUCTION,
  brand: AppReleaseBrand.SOFTLOGIC,
  platform: AppReleasePlatform.ANDROID,
  versionName: '1.0.20',
  buildNumber: 21,
  releaseDate: new Date('2026-06-13T00:00:00.000Z'),
  notes: 'Release notes',
  downloadUrl: 'https://drive.google.com/file/d/prod-softlogic-apk/view?usp=sharing',
  isCurrent: true,
  isActive: true,
  createdAt: new Date('2026-06-13T00:00:00.000Z'),
  updatedAt: new Date('2026-06-13T00:00:00.000Z'),
  ...overrides,
});

const superAdmin = {
  userId: '22222222-2222-2222-2222-222222222222',
  role: UserRole.SUPER_ADMIN,
};

describe('AppUpdateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an update only for a newer exact channel match', async () => {
    appReleaseMock.findFirst.mockResolvedValue(release());

    const result = await appUpdateService.checkForUpdate({
      environment: 'production',
      brand: 'softlogic',
      platform: 'android',
      buildNumber: 20,
    });

    expect(appReleaseMock.findFirst).toHaveBeenCalledWith({
      where: {
        environment: AppReleaseEnvironment.PRODUCTION,
        brand: AppReleaseBrand.SOFTLOGIC,
        platform: AppReleasePlatform.ANDROID,
        isActive: true,
        isCurrent: true,
      },
      orderBy: [{ buildNumber: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result).toMatchObject({
      updateAvailable: true,
      release: {
        environment: 'production',
        brand: 'softlogic',
        platform: 'android',
        versionName: '1.0.20',
        buildNumber: 21,
      },
    });
  });

  it.each(
    (['staging', 'production'] as const).flatMap((environment) =>
      (['softlogic', 'ai_smart_board'] as const).flatMap((brand) =>
        (['android', 'windows'] as const).map((platform) => ({
          environment,
          brand,
          platform,
        })),
      ),
    ),
  )(
    'matches the $environment $brand $platform channel independently',
    async ({ environment, brand, platform }) => {
      const environmentEnum =
        environment === 'production'
          ? AppReleaseEnvironment.PRODUCTION
          : AppReleaseEnvironment.STAGING;
      const brandEnum =
        brand === 'ai_smart_board'
          ? AppReleaseBrand.AI_SMART_BOARD
          : AppReleaseBrand.SOFTLOGIC;
      const platformEnum =
        platform === 'windows'
          ? AppReleasePlatform.WINDOWS
          : AppReleasePlatform.ANDROID;
      appReleaseMock.findFirst.mockResolvedValue(
        release({
          environment: environmentEnum,
          brand: brandEnum,
          platform: platformEnum,
        }),
      );

      const result = await appUpdateService.checkForUpdate({
        environment,
        brand,
        platform,
        buildNumber: 20,
      });

      expect(result).toMatchObject({
        updateAvailable: true,
        release: { environment, brand, platform },
      });
    },
  );

  it('does not return an update for equal or newer installed builds', async () => {
    appReleaseMock.findFirst.mockResolvedValue(release());

    await expect(
      appUpdateService.checkForUpdate({
        environment: 'production',
        brand: 'softlogic',
        platform: 'android',
        buildNumber: 21,
      }),
    ).resolves.toMatchObject({ updateAvailable: false });
  });

  it('ignores inactive or missing current releases through the query filter', async () => {
    appReleaseMock.findFirst.mockResolvedValue(null);

    await expect(
      appUpdateService.checkForUpdate({
        environment: 'staging',
        brand: 'ai_smart_board',
        platform: 'windows',
        buildNumber: 1,
      }),
    ).resolves.toEqual({ updateAvailable: false, release: null });

    expect(appReleaseMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          environment: AppReleaseEnvironment.STAGING,
          brand: AppReleaseBrand.AI_SMART_BOARD,
          platform: AppReleasePlatform.WINDOWS,
          isActive: true,
          isCurrent: true,
        }),
      }),
    );
  });

  it('blocks release management for non Super Admin users', async () => {
    await expect(
      appUpdateService.listReleases(
        { userId: '33333333-3333-3333-3333-333333333333', role: UserRole.ADMIN },
        {},
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('publishes all 8 channels and marks previous current releases inactive per channel', async () => {
    const artifacts = (['staging', 'production'] as const).flatMap((environment) =>
      (['softlogic', 'ai_smart_board'] as const).flatMap((brand) =>
        (['android', 'windows'] as const).map((platform) => ({
          environment,
          brand,
          platform,
          downloadUrl: `https://drive.google.com/file/d/${environment}-${brand}-${platform}/view?usp=sharing`,
        })),
      ),
    );
    const tx = {
      appRelease: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn((input) =>
          Promise.resolve(
            release({
              environment: input.create.environment,
              brand: input.create.brand,
              platform: input.create.platform,
              versionName: input.create.versionName,
              buildNumber: input.create.buildNumber,
              downloadUrl: input.create.downloadUrl,
            }),
          ),
        ),
      },
    };
    transactionMock.mockImplementation((callback) => callback(tx));

    const result = await appUpdateService.publishFullRelease(superAdmin, {
      versionName: '1.0.20',
      buildNumber: 21,
      releaseDate: new Date('2026-06-13T00:00:00.000Z'),
      notes: 'All channels',
      artifacts,
    });

    expect(tx.appRelease.updateMany).toHaveBeenCalledTimes(8);
    expect(tx.appRelease.upsert).toHaveBeenCalledTimes(8);
    expect(result).toHaveLength(8);
  });
});
