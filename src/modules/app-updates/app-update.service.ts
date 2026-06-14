import { AppRelease, AppReleasePlatform, Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { writeAuditLog } from '@/shared/utils/audit';
import {
  fromReleaseBrand,
  fromReleaseEnvironment,
  fromReleasePlatform,
  toAppReleaseDto,
  toReleaseBrand,
  toReleaseEnvironment,
  toReleasePlatform,
} from './app-update.mapper';
import type {
  CheckAppUpdateQuery,
  CurrentAppDownloadsQuery,
  ListAppReleasesQuery,
  PublishFullAppReleaseInput,
  UpdateAppReleaseInput,
} from './app-update.validator';

type Actor = {
  userId: string;
  role: UserRole;
};

const RELEASE_ORDER: Prisma.AppReleaseOrderByWithRelationInput[] = [
  { environment: 'asc' },
  { brand: 'asc' },
  { platform: 'asc' },
  { buildNumber: 'desc' },
  { createdAt: 'desc' },
];

const assertSuperAdmin = (actor: Actor): void => {
  if (actor.role !== UserRole.SUPER_ADMIN) {
    throw new AppError('Only Super Admin can manage app releases', 403);
  }
};

const toPublicUpdateRelease = (release: AppRelease) => ({
  environment: fromReleaseEnvironment(release.environment),
  brand: fromReleaseBrand(release.brand),
  platform: fromReleasePlatform(release.platform),
  versionName: release.versionName,
  buildNumber: release.buildNumber,
  releaseDate: release.releaseDate.toISOString().slice(0, 10),
  notes: release.notes,
  downloadUrl: release.downloadUrl,
});

export class AppUpdateService {
  async checkForUpdate(query: CheckAppUpdateQuery) {
    const latest = await prisma.appRelease.findFirst({
      where: {
        environment: toReleaseEnvironment(query.environment),
        brand: toReleaseBrand(query.brand),
        platform: toReleasePlatform(query.platform),
        isActive: true,
        isCurrent: true,
      },
      orderBy: [{ buildNumber: 'desc' }, { createdAt: 'desc' }],
    });

    if (!latest || latest.buildNumber <= query.buildNumber) {
      return {
        updateAvailable: false,
        release: latest ? toPublicUpdateRelease(latest) : null,
      };
    }

    return {
      updateAvailable: true,
      release: toPublicUpdateRelease(latest),
    };
  }

  async getCurrentDownloads(query: CurrentAppDownloadsQuery) {
    const releases = await prisma.appRelease.findMany({
      where: {
        environment: toReleaseEnvironment(query.environment),
        brand: toReleaseBrand(query.brand),
        platform: { in: [AppReleasePlatform.ANDROID, AppReleasePlatform.WINDOWS] },
        isActive: true,
        isCurrent: true,
      },
      orderBy: [{ platform: 'asc' }, { buildNumber: 'desc' }, { createdAt: 'desc' }],
    });

    return releases.map(toPublicUpdateRelease);
  }

  async listReleases(actor: Actor, query: ListAppReleasesQuery) {
    assertSuperAdmin(actor);

    const where: Prisma.AppReleaseWhereInput = {
      environment: query.environment
        ? toReleaseEnvironment(query.environment)
        : undefined,
      brand: query.brand ? toReleaseBrand(query.brand) : undefined,
      platform: query.platform ? toReleasePlatform(query.platform) : undefined,
      isCurrent: query.currentOnly ? true : undefined,
    };

    const releases = await prisma.appRelease.findMany({
      where,
      orderBy: RELEASE_ORDER,
    });
    return releases.map(toAppReleaseDto);
  }

  async publishFullRelease(actor: Actor, input: PublishFullAppReleaseInput) {
    assertSuperAdmin(actor);

    const releases = await prisma.$transaction(async (tx) => {
      const saved: AppRelease[] = [];

      for (const artifact of input.artifacts) {
        const environment = toReleaseEnvironment(artifact.environment);
        const brand = toReleaseBrand(artifact.brand);
        const platform = toReleasePlatform(artifact.platform);

        await tx.appRelease.updateMany({
          where: { environment, brand, platform, isCurrent: true },
          data: { isCurrent: false },
        });

        const release = await tx.appRelease.upsert({
          where: {
            environment_brand_platform_buildNumber: {
              environment,
              brand,
              platform,
              buildNumber: input.buildNumber,
            },
          },
          create: {
            environment,
            brand,
            platform,
            versionName: input.versionName,
            buildNumber: input.buildNumber,
            releaseDate: input.releaseDate,
            notes: input.notes?.trim() || null,
            downloadUrl: artifact.downloadUrl,
            isCurrent: true,
            isActive: true,
          },
          update: {
            versionName: input.versionName,
            releaseDate: input.releaseDate,
            notes: input.notes?.trim() || null,
            downloadUrl: artifact.downloadUrl,
            isCurrent: true,
            isActive: true,
          },
        });

        saved.push(release);
      }

      return saved;
    });

    await writeAuditLog({
      actorUserId: actor.userId,
      action: 'APP_RELEASE_FULL_PUBLISH',
      targetType: 'AppRelease',
      summary: `Published app release ${input.versionName}+${input.buildNumber} for all channels`,
      metadata: {
        versionName: input.versionName,
        buildNumber: input.buildNumber,
        channels: releases.length,
      },
    });

    return releases.map(toAppReleaseDto);
  }

  async updateRelease(actor: Actor, id: string, input: UpdateAppReleaseInput) {
    assertSuperAdmin(actor);

    const existing = await prisma.appRelease.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('App release not found', 404);
    }

    if ((input.isCurrent || existing.isCurrent) && input.isActive === false) {
      throw new AppError('A current release must be active', 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.appRelease.updateMany({
          where: {
            environment: existing.environment,
            brand: existing.brand,
            platform: existing.platform,
            isCurrent: true,
            id: { not: existing.id },
          },
          data: { isCurrent: false },
        });
      }

      return tx.appRelease.update({
        where: { id },
        data: {
          versionName: input.versionName,
          buildNumber: input.buildNumber,
          releaseDate: input.releaseDate,
          notes:
            input.notes === undefined
              ? undefined
              : input.notes?.trim() || null,
          downloadUrl: input.downloadUrl,
          isCurrent: input.isCurrent,
          isActive: input.isActive,
        },
      });
    });

    await writeAuditLog({
      actorUserId: actor.userId,
      action: 'APP_RELEASE_UPDATE',
      targetType: 'AppRelease',
      targetId: id,
      summary: `Updated app release ${updated.versionName}+${updated.buildNumber}`,
      metadata: toAppReleaseDto(updated),
    });

    return toAppReleaseDto(updated);
  }
}

export const appUpdateService = new AppUpdateService();
