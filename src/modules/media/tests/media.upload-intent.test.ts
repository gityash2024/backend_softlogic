import { env } from '@/config';
import { mediaController } from '@/modules/media/media.controller';
import {
  MAX_MEDIA_UPLOAD_BYTES,
  mediaService,
} from '@/modules/media/media.service';

const makeResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

describe('media upload intent', () => {
  const originalStorageType = env.STORAGE_TYPE;
  const originalStorageBucket = env.STORAGE_BUCKET;
  const originalStorageEndpoint = env.STORAGE_ENDPOINT;
  const originalStorageRegion = env.STORAGE_REGION;
  const originalStorageAccessKeyId = env.STORAGE_ACCESS_KEY_ID;
  const originalStorageSecretAccessKey = env.STORAGE_SECRET_ACCESS_KEY;
  const originalStoragePublicBaseUrl = env.STORAGE_PUBLIC_BASE_URL;

  beforeEach(() => {
    env.STORAGE_TYPE = 's3';
    env.STORAGE_BUCKET = 'media-bucket';
    env.STORAGE_ENDPOINT = 'https://storage.example.com';
    env.STORAGE_REGION = 'ap-southeast-2';
    env.STORAGE_ACCESS_KEY_ID = 'storage-key';
    env.STORAGE_SECRET_ACCESS_KEY = 'storage-secret';
    env.STORAGE_PUBLIC_BASE_URL = 'https://cdn.example.com';
  });

  afterEach(() => {
    env.STORAGE_TYPE = originalStorageType;
    env.STORAGE_BUCKET = originalStorageBucket;
    env.STORAGE_ENDPOINT = originalStorageEndpoint;
    env.STORAGE_REGION = originalStorageRegion;
    env.STORAGE_ACCESS_KEY_ID = originalStorageAccessKeyId;
    env.STORAGE_SECRET_ACCESS_KEY = originalStorageSecretAccessKey;
    env.STORAGE_PUBLIC_BASE_URL = originalStoragePublicBaseUrl;
    jest.restoreAllMocks();
  });

  it('returns an authenticated signed PUT intent with a sanitized per-user key', async () => {
    const req = {
      body: {
        fileName: 'My photo (final).png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      },
      user: { userId: 'User / One' },
      protocol: 'https',
      get: jest.fn((header: string) =>
        header.toLowerCase() === 'host' ? 'api.example.com' : undefined,
      ),
    };
    const res = makeResponse();
    const next = jest.fn();

    await mediaController.createUploadIntent(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const intent = res.json.mock.calls[0]?.[0].data;
    expect(intent).toMatchObject({
      provider: 's3',
      method: 'PUT',
      publicUrl: expect.stringMatching(
        /^https:\/\/api\.example\.com\/api\/v1\/media\/object\//,
      ),
      storageKey: expect.stringMatching(/^media\/user-one\//),
      headers: { 'Content-Type': 'image/png' },
      maxSizeBytes: MAX_MEDIA_UPLOAD_BYTES,
    });
    expect(intent.storageKey).toMatch(/My_photo__final_\.png$/);
    expect(decodeURIComponent(intent.publicUrl)).toContain(intent.storageKey);
    expect(intent.uploadUrl).toContain('X-Amz-Signature=');
    expect(JSON.stringify(intent)).not.toContain('storage-secret');
  });

  it('rejects unsupported media types', async () => {
    await expect(
      mediaService.createUploadIntent('user-1', {
        fileName: 'page.html',
        mimeType: 'text/html',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({
      message: 'Unsupported media type',
      statusCode: 415,
    });
  });

  it('rejects files over the media upload size limit', async () => {
    await expect(
      mediaService.createUploadIntent('user-1', {
        fileName: 'movie.mp4',
        mimeType: 'video/mp4',
        sizeBytes: MAX_MEDIA_UPLOAD_BYTES + 1,
      }),
    ).rejects.toMatchObject({
      message: 'Media uploads support files up to 250 MB',
      statusCode: 413,
    });
  });
});
