export const appVersionMetadata = {
  productName: 'Softlogic Whiteboard',
  backendName: 'softlogic-whiteboard-backend',
  release: 'v1.0.1',
  version: '1.0.1',
  build: 2,
  apiVersion: 'v1',
  releaseDate: '2026-05-01',
  flutter: {
    version: '1.0.1',
    buildNumber: 2,
    buildName: '1.0.1+2',
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
