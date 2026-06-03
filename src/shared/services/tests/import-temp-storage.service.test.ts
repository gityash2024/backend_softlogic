import { env } from '@/config';
import {
  createSignedImportObjectUploadIntent,
  isExpectedImportObjectKey,
  MAX_DOCUMENT_IMPORT_BYTES,
} from '@/shared/services/import-temp-storage.service';

describe('import temp object storage upload intent', () => {
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
  });

  it('returns a signed PUT intent without exposing the storage secret', async () => {
    const intent = await createSignedImportObjectUploadIntent({
      filename: 'MAY CA.pptx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      userId: 'user-1',
    });

    expect(intent.provider).toBe('s3');
    expect(intent.method).toBe('PUT');
    expect(intent.maxSizeBytes).toBe(MAX_DOCUMENT_IMPORT_BYTES);
    expect(intent.storageKey).toContain('softlogic/imports/user-1/');
    expect(intent.storageKey).toMatch(/may-ca\.pptx$/);
    expect(intent.uploadUrl).toContain('X-Amz-Signature=');
    expect(intent.uploadUrl).not.toContain('storage-secret');
    expect(intent.headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(
      isExpectedImportObjectKey({
        storageKey: intent.storageKey,
        userId: 'user-1',
      }),
    ).toBe(true);
  });
});
