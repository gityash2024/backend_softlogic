import { env } from '@/config';
import { exportController } from '@/modules/export/export.controller';

const makeResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

describe('ExportController import upload intent', () => {
  const originalStorageBucket = env.STORAGE_BUCKET;
  const originalStorageEndpoint = env.STORAGE_ENDPOINT;
  const originalStorageAccessKeyId = env.STORAGE_ACCESS_KEY_ID;
  const originalStorageSecretAccessKey = env.STORAGE_SECRET_ACCESS_KEY;

  beforeEach(() => {
    env.STORAGE_BUCKET = 'import-bucket';
    env.STORAGE_ENDPOINT = 'https://storage.example.com';
    env.STORAGE_ACCESS_KEY_ID = 'storage-key';
    env.STORAGE_SECRET_ACCESS_KEY = 'storage-secret';
  });

  afterEach(() => {
    env.STORAGE_BUCKET = originalStorageBucket;
    env.STORAGE_ENDPOINT = originalStorageEndpoint;
    env.STORAGE_ACCESS_KEY_ID = originalStorageAccessKeyId;
    env.STORAGE_SECRET_ACCESS_KEY = originalStorageSecretAccessKey;
    jest.restoreAllMocks();
  });

  it.each([
    ['deck.pptx', 'pptx'],
    ['legacy.ppt', 'ppt'],
    ['document.pdf', 'pdf'],
  ])('accepts %s files at the 50 MB limit', async (sourceName, sourceExtension) => {
    const req = {
      body: {
        sourceName,
        sourceExtension,
        mimeType:
          sourceExtension === 'pdf'
            ? 'application/pdf'
            : sourceExtension === 'ppt'
              ? 'application/vnd.ms-powerpoint'
              : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sizeBytes: 50 * 1024 * 1024,
      },
      user: { userId: 'user-1' },
    };
    const res = makeResponse();
    const next = jest.fn();

    await exportController.createImportUploadIntent(
      req as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]?.[0].data).toMatchObject({
      provider: 's3',
      method: 'PUT',
      maxSizeBytes: 50 * 1024 * 1024,
    });
    expect(res.json.mock.calls[0]?.[0].data.uploadUrl).not.toContain(
      'storage-secret',
    );
  });

  it('rejects PowerPoint files over 50 MB', async () => {
    const req = {
      body: {
        sourceName: 'deck.pptx',
        sourceExtension: 'pptx',
        sizeBytes: 50 * 1024 * 1024 + 1,
      },
      user: { userId: 'user-1' },
    };
    const res = makeResponse();
    const next = jest.fn();

    await exportController.createImportUploadIntent(
      req as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'File size should not be more than 50 MB.',
        statusCode: 413,
        code: 'IMPORT_FILE_TOO_LARGE',
      }),
    );
  });

  it('rejects unsupported upload-intent extensions', async () => {
    const req = {
      body: {
        sourceName: 'photo.png',
        sourceExtension: 'png',
        sizeBytes: 1024,
      },
      user: { userId: 'user-1' },
    };
    const res = makeResponse();
    const next = jest.fn();

    await exportController.createImportUploadIntent(
      req as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Only PDF and PowerPoint files can use remote import upload.',
        statusCode: 400,
        code: 'IMPORT_UNSUPPORTED_TYPE',
      }),
    );
  });

  it('rejects empty files before creating an upload intent', async () => {
    const req = {
      body: {
        sourceName: 'document.pdf',
        sourceExtension: 'pdf',
        sizeBytes: 0,
      },
      user: { userId: 'user-1' },
    };
    const res = makeResponse();
    const next = jest.fn();

    await exportController.createImportUploadIntent(
      req as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'IMPORT_EMPTY_FILE',
        statusCode: 400,
      }),
    );
  });

  it('rejects a MIME type that does not match the extension', async () => {
    const req = {
      body: {
        sourceName: 'document.pdf',
        sourceExtension: 'pdf',
        mimeType: 'image/png',
        sizeBytes: 1024,
      },
      user: { userId: 'user-1' },
    };
    const res = makeResponse();
    const next = jest.fn();

    await exportController.createImportUploadIntent(
      req as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'IMPORT_UNSUPPORTED_TYPE',
        statusCode: 400,
      }),
    );
  });
});
