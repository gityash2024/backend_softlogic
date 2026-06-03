import path from 'path';
import { randomUUID } from 'crypto';
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

export interface SignedRawUploadIntent {
  uploadUrl: string;
  publicId: string;
  expiresAt: string;
  fields: Record<string, string>;
}

const DOCUMENT_IMPORT_FOLDER = 'softlogic/imports';

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

export const createSignedRawUploadIntent = ({
  filename,
  userId,
}: {
  filename: string;
  userId: string;
}): SignedRawUploadIntent => {
  ensureConfigured();

  const extension = path.extname(filename).toLowerCase();
  const basename =
    sanitizePublicId(path.basename(filename, extension)) || 'document';
  const safeUserId = sanitizePublicId(userId) || 'user';
  const publicId = `${DOCUMENT_IMPORT_FOLDER}/${safeUserId}/${Date.now()}-${randomUUID()}-${basename}${extension}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const fieldsToSign = {
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };
  const signature = cloudinary.utils.api_sign_request(
    fieldsToSign,
    env.CLOUDINARY_API_SECRET!,
  );

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/raw/upload`,
    publicId,
    expiresAt: new Date((Number(timestamp) + 10 * 60) * 1000).toISOString(),
    fields: {
      ...fieldsToSign,
      api_key: env.CLOUDINARY_API_KEY!,
      signature,
    },
  };
};

export const isExpectedImportRawAsset = ({
  fileUrl,
  publicId,
}: {
  fileUrl: string;
  publicId?: string | null;
}): boolean => {
  if (!env.CLOUDINARY_CLOUD_NAME) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return false;
  }

  const expectedPathPrefix = `/${env.CLOUDINARY_CLOUD_NAME}/raw/upload/`;
  const expectedPublicIdPrefix = `${DOCUMENT_IMPORT_FOLDER}/`;
  return (
    url.protocol === 'https:' &&
    url.hostname === 'res.cloudinary.com' &&
    url.pathname.startsWith(expectedPathPrefix) &&
    url.pathname.includes(`/${expectedPublicIdPrefix}`) &&
    (!publicId || publicId.startsWith(expectedPublicIdPrefix))
  );
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

export const deleteRawAsset = async (
  publicId: string | null | undefined,
): Promise<void> => {
  if (!publicId) {
    return;
  }

  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: 'raw',
    invalidate: true,
  });
};
