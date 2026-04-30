import request from 'supertest';

import { createApp } from '@/app';
import { swaggerSpec } from '@/config';
import { appVersionMetadata } from '@/config/version';

describe('version metadata', () => {
  const app = createApp();

  it.each(['/api/version', '/api/v1/version'])(
    'returns public version metadata from %s',
    async (path) => {
      const response = await request(app).get(path);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          success: true,
          message: 'Version metadata',
          data: expect.objectContaining({
            productName: appVersionMetadata.productName,
            release: appVersionMetadata.release,
            version: appVersionMetadata.version,
            build: appVersionMetadata.build,
            releaseDate: appVersionMetadata.releaseDate,
            backend: {
              name: appVersionMetadata.backendName,
              version: appVersionMetadata.version,
            },
            flutter: appVersionMetadata.flutter,
          }),
        }),
      );
    },
  );

  it('uses the centralized version in Swagger metadata', () => {
    expect((swaggerSpec as { info: { version: string } }).info.version).toBe(
      appVersionMetadata.version,
    );
  });

  it.each(['/api/docs.json', '/api/v1/docs.json'])(
    'returns the raw Swagger spec from %s',
    async (path) => {
      const response = await request(app).get(path);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          openapi: '3.0.0',
          info: expect.objectContaining({
            title: 'Softlogic Whiteboard API',
            version: appVersionMetadata.version,
          }),
        }),
      );
    },
  );
});
