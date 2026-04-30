export const appVersionMetadata = {
  productName: 'Softlogic Whiteboard',
  backendName: 'softlogic-whiteboard-backend',
  release: 'v1.0.0',
  version: '1.0.0',
  build: 1,
  apiVersion: 'v1',
  releaseDate: '2026-04-28',
  flutter: {
    version: '1.0.0',
    buildNumber: 1,
    buildName: '1.0.0+1',
  },
} as const;

export const createVersionPayload = (
  apiVersion = appVersionMetadata.apiVersion,
) => ({
  productName: appVersionMetadata.productName,
  release: appVersionMetadata.release,
  version: appVersionMetadata.version,
  build: appVersionMetadata.build,
  apiVersion,
  releaseDate: appVersionMetadata.releaseDate,
  backend: {
    name: appVersionMetadata.backendName,
    version: appVersionMetadata.version,
  },
  flutter: appVersionMetadata.flutter,
});

export type AppVersionPayload = ReturnType<typeof createVersionPayload>;
