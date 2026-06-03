import { env } from '@/config';
import { createSignedRawUploadIntent } from '@/shared/services/cloudinary.service';

describe('cloudinary import upload intent', () => {
  const originalCloudName = env.CLOUDINARY_CLOUD_NAME;
  const originalApiKey = env.CLOUDINARY_API_KEY;
  const originalApiSecret = env.CLOUDINARY_API_SECRET;

  beforeEach(() => {
    env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    env.CLOUDINARY_API_KEY = 'demo-key';
    env.CLOUDINARY_API_SECRET = 'demo-secret';
  });

  afterEach(() => {
    env.CLOUDINARY_CLOUD_NAME = originalCloudName;
    env.CLOUDINARY_API_KEY = originalApiKey;
    env.CLOUDINARY_API_SECRET = originalApiSecret;
  });

  it('returns a signed raw upload intent without exposing the API secret', () => {
    const intent = createSignedRawUploadIntent({
      filename: 'MAY CA.pptx',
      userId: 'user-1',
    });

    expect(intent.uploadUrl).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/raw/upload',
    );
    expect(intent.publicId).toContain('softlogic/imports/user-1/');
    expect(intent.publicId).toMatch(/may-ca\.pptx$/);
    expect(intent.fields.api_key).toBe('demo-key');
    expect(intent.fields.public_id).toBe(intent.publicId);
    expect(intent.fields.signature).toBeTruthy();
    expect(Object.values(intent.fields)).not.toContain('demo-secret');
  });
});
