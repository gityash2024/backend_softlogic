export const appVersionMetadata = {
  productName: 'Softlogic Whiteboard',
  backendName: 'softlogic-whiteboard-backend',
  release: 'v1.0.17',
  version: '1.0.17',
  build: 18,
  apiVersion: 'v1',
  releaseDate: '2026-06-07',
  flutter: {
    version: '1.0.17',
    buildNumber: 18,
    buildName: '1.0.17+18',
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
