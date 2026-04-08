import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';

let configured = false;

const ensureConfigured = (): void => {
  if (configured) {
    return;
  }

  if (
    !env.CLOUDINARY_CLOUD_NAME ||
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  ) {
    throw new AppError('Cloudinary is not configured.', 503);
  }

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
};

const sanitizePublicId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

export interface UploadedImageAsset {
  url: string;
  publicId: string;
}

export const uploadImageBuffer = async ({
  buffer,
  filename,
  folder,
}: {
  buffer: Buffer;
  filename: string;
  folder: string;
}): Promise<UploadedImageAsset> => {
  ensureConfigured();

  const basename = path.basename(filename, path.extname(filename));
  const publicId = sanitizePublicId(`${basename}-${Date.now()}`);

  return new Promise<UploadedImageAsset>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        overwrite: true,
      },
      (error, result) => {
        if (error || !result?.secure_url || !result.public_id) {
          reject(error ?? new AppError('Unable to upload image.', 500));
          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      },
    );

    stream.end(buffer);
  });
};

export const deleteImageAsset = async (
  publicId: string | null | undefined,
): Promise<void> => {
  if (!publicId) {
    return;
  }

  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
};
