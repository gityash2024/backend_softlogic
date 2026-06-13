import {
  AppRelease,
  AppReleaseBrand,
  AppReleaseEnvironment,
  AppReleasePlatform,
} from '@prisma/client';

export type PublicReleaseEnvironment = 'staging' | 'production';
export type PublicReleaseBrand = 'softlogic' | 'ai_smart_board';
export type PublicReleasePlatform = 'android' | 'windows';

export const toReleaseEnvironment = (
  value: PublicReleaseEnvironment,
): AppReleaseEnvironment =>
  value === 'production'
    ? AppReleaseEnvironment.PRODUCTION
    : AppReleaseEnvironment.STAGING;

export const toReleaseBrand = (value: PublicReleaseBrand): AppReleaseBrand =>
  value === 'ai_smart_board'
    ? AppReleaseBrand.AI_SMART_BOARD
    : AppReleaseBrand.SOFTLOGIC;

export const toReleasePlatform = (
  value: PublicReleasePlatform,
): AppReleasePlatform =>
  value === 'windows'
    ? AppReleasePlatform.WINDOWS
    : AppReleasePlatform.ANDROID;

export const fromReleaseEnvironment = (
  value: AppReleaseEnvironment,
): PublicReleaseEnvironment =>
  value === AppReleaseEnvironment.PRODUCTION ? 'production' : 'staging';

export const fromReleaseBrand = (
  value: AppReleaseBrand,
): PublicReleaseBrand =>
  value === AppReleaseBrand.AI_SMART_BOARD ? 'ai_smart_board' : 'softlogic';

export const fromReleasePlatform = (
  value: AppReleasePlatform,
): PublicReleasePlatform =>
  value === AppReleasePlatform.WINDOWS ? 'windows' : 'android';

export const toAppReleaseDto = (release: AppRelease) => ({
  id: release.id,
  environment: fromReleaseEnvironment(release.environment),
  brand: fromReleaseBrand(release.brand),
  platform: fromReleasePlatform(release.platform),
  versionName: release.versionName,
  buildNumber: release.buildNumber,
  releaseDate: release.releaseDate.toISOString().slice(0, 10),
  notes: release.notes,
  downloadUrl: release.downloadUrl,
  isCurrent: release.isCurrent,
  isActive: release.isActive,
  createdAt: release.createdAt.toISOString(),
  updatedAt: release.updatedAt.toISOString(),
});
