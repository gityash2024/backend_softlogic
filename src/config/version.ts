export const appVersionMetadata = {
  productName: 'Softlogic Whiteboard',
  backendName: 'softlogic-whiteboard-backend',
  release: 'v1.0.19',
  version: '1.0.19',
  build: 20,
  apiVersion: 'v1',
  releaseDate: '2026-06-13',
  flutter: {
    version: '1.0.19',
    buildNumber: 20,
    buildName: '1.0.19+20',
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
