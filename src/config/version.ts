export const appVersionMetadata = {
  productName: 'Softlogic Whiteboard',
  backendName: 'softlogic-whiteboard-backend',
  release: 'v1.0.20',
  version: '1.0.20',
  build: 21,
  apiVersion: 'v1',
  releaseDate: '2026-06-13',
  flutter: {
    version: '1.0.20',
    buildNumber: 21,
    buildName: '1.0.20+21',
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
