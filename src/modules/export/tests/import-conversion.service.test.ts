import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { importConversionService } from '@/modules/export/import-conversion.service';

describe('ImportConversionService', () => {
  const originalWorkerUrl = env.IMPORT_CONVERSION_WORKER_URL;
  const originalWorkerToken = env.IMPORT_CONVERSION_WORKER_TOKEN;
  const originalConvertApiToken = env.CONVERTAPI_TOKEN;
  const originalConvertApiBaseUrl = env.CONVERTAPI_BASE_URL;
  const originalCloudinaryCloudName = env.CLOUDINARY_CLOUD_NAME;
  const originalStorageBucket = env.STORAGE_BUCKET;
  const originalStorageEndpoint = env.STORAGE_ENDPOINT;
  const originalStorageAccessKeyId = env.STORAGE_ACCESS_KEY_ID;
  const originalStorageSecretAccessKey = env.STORAGE_SECRET_ACCESS_KEY;
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3QkwAAAABJRU5ErkJggg==';

  beforeEach(() => {
    env.IMPORT_CONVERSION_WORKER_URL = 'https://worker.example/convert';
    env.IMPORT_CONVERSION_WORKER_TOKEN = 'test-token';
    env.CONVERTAPI_TOKEN = undefined;
    env.CONVERTAPI_BASE_URL = 'https://v2.convertapi.com';
    env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    env.STORAGE_BUCKET = undefined;
    env.STORAGE_ENDPOINT = undefined;
    env.STORAGE_ACCESS_KEY_ID = undefined;
    env.STORAGE_SECRET_ACCESS_KEY = undefined;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    env.IMPORT_CONVERSION_WORKER_URL = originalWorkerUrl;
    env.IMPORT_CONVERSION_WORKER_TOKEN = originalWorkerToken;
    env.CONVERTAPI_TOKEN = originalConvertApiToken;
    env.CONVERTAPI_BASE_URL = originalConvertApiBaseUrl;
    env.CLOUDINARY_CLOUD_NAME = originalCloudinaryCloudName;
    env.STORAGE_BUCKET = originalStorageBucket;
    env.STORAGE_ENDPOINT = originalStorageEndpoint;
    env.STORAGE_ACCESS_KEY_ID = originalStorageAccessKeyId;
    env.STORAGE_SECRET_ACCESS_KEY = originalStorageSecretAccessKey;
    jest.resetAllMocks();
  });

  it('returns ordered converted PDF page assets from the worker', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          sourceName: 'demo.pdf',
          pages: [
            {
              name: 'Page 1',
              width: 1280,
              height: 720,
              imageBase64: 'ZmFrZQ==',
            },
            {
              name: 'Page 2',
              width: 1280,
              height: 720,
              imageBase64: 'ZmFrZTI=',
            },
          ],
        },
      }),
    });

    const result = await importConversionService.convertDocument({
      requestedType: 'pdf',
      fileBuffer: Buffer.from('pdf'),
      fileName: 'demo.pdf',
      mimeType: 'application/pdf',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.format).toBe('PDF');
    expect(result.sourceName).toBe('demo.pdf');
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.name).toBe('Page 1');
  });

  it('forwards legacy PPT files to the worker and returns PPT page assets', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          sourceName: 'legacy.ppt',
          pages: [
            {
              name: 'Slide 1',
              width: 960,
              height: 540,
              imageBase64: 'ZmFrZQ==',
            },
          ],
        },
      }),
    });

    const result = await importConversionService.convertDocument({
      requestedType: 'ppt',
      fileBuffer: Buffer.from('ppt'),
      fileName: 'legacy.ppt',
      mimeType: 'application/vnd.ms-powerpoint',
      metadata: {
        sourceExtension: 'ppt',
        renderMode: 'full_slide_raster',
        conversionMode: 'full_slide_raster',
        extractEmbeddedImages: 'false',
      },
    });

    const form = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('type')).toBe('ppt');
    expect(form.get('sourceExtension')).toBe('ppt');
    expect(form.get('renderMode')).toBe('full_slide_raster');
    expect(form.get('conversionMode')).toBe('full_slide_raster');
    expect(form.get('extractEmbeddedImages')).toBe('false');
    expect(result.format).toBe('PPT');
    expect(result.pages).toHaveLength(1);
  });

  it('normalizes PPTX import type before forwarding to the worker', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          sourceName: 'deck.pptx',
          pages: [
            {
              name: 'Slide 1',
              width: 1280,
              height: 720,
              imageBase64: 'ZmFrZQ==',
            },
          ],
        },
      }),
    });

    const result = await importConversionService.convertDocument({
      requestedType: 'pptx',
      fileBuffer: Buffer.from('pptx'),
      fileName: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      metadata: {
        sourceExtension: 'pptx',
      },
    });

    const form = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('type')).toBe('ppt');
    expect(form.get('sourceExtension')).toBe('pptx');
    expect(result.format).toBe('PPTX');
    expect(result.pages).toHaveLength(1);
  });

  it('uses ConvertAPI for PPTX imports when the worker is not configured', async () => {
    env.IMPORT_CONVERSION_WORKER_URL = undefined;
    env.IMPORT_CONVERSION_WORKER_TOKEN = undefined;
    env.CONVERTAPI_TOKEN = 'convertapi-token';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Files: [
          { FileName: 'deck-1.png', FileData: tinyPngBase64 },
          { FileName: 'deck-2.png', FileData: tinyPngBase64 },
        ],
      }),
    });

    const result = await importConversionService.convertDocument({
      requestedType: 'ppt',
      fileBuffer: Buffer.from('pptx'),
      fileName: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      metadata: {
        sourceExtension: 'pptx',
        renderMode: 'full_slide_raster',
      },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0]?.[0]).toBe(
      'https://v2.convertapi.com/convert/pptx/to/png',
    );
    expect((global.fetch as jest.Mock).mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer convertapi-token',
    });
    const form = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('StoreFile')).toBe('false');
    expect(form.get('PageRange')).toBe('1-2000');
    expect(result.format).toBe('PPTX');
    expect(result.sourceName).toBe('deck.pptx');
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toMatchObject({
      name: 'deck-1.png',
      width: 1280,
      height: 720,
      imageBase64: tinyPngBase64,
    });
  });

  it('uses ConvertAPI for legacy PPT imports when the worker is not configured', async () => {
    env.IMPORT_CONVERSION_WORKER_URL = undefined;
    env.IMPORT_CONVERSION_WORKER_TOKEN = undefined;
    env.CONVERTAPI_TOKEN = 'convertapi-token';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Files: [{ FileName: 'legacy-1.png', FileData: tinyPngBase64 }],
      }),
    });

    const result = await importConversionService.convertDocument({
      requestedType: 'ppt',
      fileBuffer: Buffer.from('ppt'),
      fileName: 'legacy.ppt',
      mimeType: 'application/vnd.ms-powerpoint',
    });

    expect((global.fetch as jest.Mock).mock.calls[0]?.[0]).toBe(
      'https://v2.convertapi.com/convert/ppt/to/png',
    );
    expect(result.format).toBe('PPT');
    expect(result.pages).toHaveLength(1);
  });

  it('uses ConvertAPI URL input for remote PPTX imports and returns slide image URLs', async () => {
    env.CONVERTAPI_TOKEN = 'convertapi-token';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Files: [
          {
            FileName: 'deck-1.png',
            Url: 'https://v2.convertapi.com/d/result-1/deck-1.png',
          },
        ],
      }),
    });

    const result = await importConversionService.convertRemoteDocument({
      requestedType: 'ppt',
      fileName: 'deck.pptx',
      fileUrl:
        'https://res.cloudinary.com/demo-cloud/raw/upload/v1/softlogic/imports/user/deck.pptx',
      publicId: 'softlogic/imports/user/deck.pptx',
    });

    expect((global.fetch as jest.Mock).mock.calls[0]?.[0]).toBe(
      'https://v2.convertapi.com/convert/pptx/to/png',
    );
    expect((global.fetch as jest.Mock).mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer convertapi-token',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0]?.[1]?.body,
    );
    expect(body.Parameters).toEqual([
      {
        Name: 'File',
        FileValue: {
          Name: 'deck.pptx',
          Url: 'https://res.cloudinary.com/demo-cloud/raw/upload/v1/softlogic/imports/user/deck.pptx',
        },
      },
      { Name: 'StoreFile', Value: true },
      { Name: 'PageRange', Value: '1-2000' },
    ]);
    expect(result.format).toBe('PPTX');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({
      name: 'deck-1.png',
      imageUrl: 'https://v2.convertapi.com/d/result-1/deck-1.png',
    });
    expect(result.pages[0]?.imageBase64).toBeUndefined();
  });

  it('uses a presigned object URL for remote PPTX imports by storage key', async () => {
    env.CONVERTAPI_TOKEN = 'convertapi-token';
    env.STORAGE_BUCKET = 'import-bucket';
    env.STORAGE_ENDPOINT = 'https://storage.example.com';
    env.STORAGE_ACCESS_KEY_ID = 'storage-key';
    env.STORAGE_SECRET_ACCESS_KEY = 'storage-secret';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Files: [
          {
            FileName: 'deck-1.png',
            Url: 'https://v2.convertapi.com/d/result-1/deck-1.png',
          },
        ],
      }),
    });

    const result = await importConversionService.convertRemoteDocument({
      requestedType: 'ppt',
      fileName: 'deck.pptx',
      storageKey: 'softlogic/imports/user-1/deck.pptx',
      userId: 'user-1',
    });

    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0]?.[1]?.body,
    );
    expect(body.Parameters[0].FileValue.Name).toBe('deck.pptx');
    expect(body.Parameters[0].FileValue.Url).toContain(
      'https://storage.example.com/import-bucket/softlogic/imports/user-1/deck.pptx',
    );
    expect(body.Parameters[0].FileValue.Url).toContain('X-Amz-Signature=');
    expect(body.Parameters[0].FileValue.Url).not.toContain('storage-secret');
    expect(result.format).toBe('PPTX');
    expect(result.pages).toHaveLength(1);
  });

  it('rejects untrusted remote import URLs', async () => {
    env.CONVERTAPI_TOKEN = 'convertapi-token';

    let thrown: unknown;
    try {
      await importConversionService.convertRemoteDocument({
        requestedType: 'ppt',
        fileName: 'deck.pptx',
        fileUrl: 'https://example.com/deck.pptx',
        publicId: 'softlogic/imports/user/deck.pptx',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(
      'Remote import file URL is not trusted.',
    );
    expect((thrown as AppError).statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps PDF import validation strict', async () => {
    let thrown: unknown;
    try {
      await importConversionService.convertDocument({
        requestedType: 'pdf',
        fileBuffer: Buffer.from('pptx'),
        fileName: 'deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(
      'Only PDF files can be imported as PDF.',
    );
    expect((thrown as AppError).statusCode).toBe(400);
  });

  it('rejects empty worker payloads cleanly', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { sourceName: 'demo.pdf', pages: [] } }),
    });

    let thrown: unknown;
    try {
      await importConversionService.convertDocument({
        requestedType: 'pdf',
        fileBuffer: Buffer.from('pdf'),
        fileName: 'demo.pdf',
        mimeType: 'application/pdf',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(
      'Import conversion worker did not return any pages.',
    );
    expect((thrown as AppError).statusCode).toBe(502);
  });

  it('returns a clear configuration error when neither worker nor ConvertAPI is configured', async () => {
    env.IMPORT_CONVERSION_WORKER_URL = undefined;
    env.IMPORT_CONVERSION_WORKER_TOKEN = undefined;
    env.CONVERTAPI_TOKEN = undefined;

    let thrown: unknown;
    try {
      await importConversionService.convertDocument({
        requestedType: 'ppt',
        fileBuffer: Buffer.from('pptx'),
        fileName: 'deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(
      'Document import conversion is not configured yet.',
    );
    expect((thrown as AppError).statusCode).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
