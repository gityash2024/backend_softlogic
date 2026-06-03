import path from 'path';
import { randomUUID } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';

export const DOCUMENT_IMPORT_FOLDER = 'softlogic/imports';
export const MAX_DOCUMENT_IMPORT_BYTES = 50 * 1024 * 1024;

const SIGNED_UPLOAD_EXPIRES_SECONDS = 10 * 60;
const SIGNED_READ_EXPIRES_SECONDS = 15 * 60;

export interface SignedObjectUploadIntent {
  provider: 's3';
  method: 'PUT';
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
  headers: Record<string, string>;
  maxSizeBytes: number;
}

interface ObjectStorageConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let client: S3Client | null = null;
let clientSignature = '';

const sanitizeKeyPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const legacyMinioEndpoint = (): string | undefined => {
  if (!env.MINIO_ENDPOINT) {
    return undefined;
  }
  if (/^https?:\/\//i.test(env.MINIO_ENDPOINT)) {
    return env.MINIO_ENDPOINT;
  }

  const port = env.MINIO_PORT ? `:${env.MINIO_PORT}` : '';
  return `https://${env.MINIO_ENDPOINT}${port}`;
};

const isLoopbackEndpoint = (endpoint: string): boolean => {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1'
    );
  } catch {
    return false;
  }
};

const objectStorageConfig = (): ObjectStorageConfig | null => {
  const bucket = env.STORAGE_BUCKET ?? env.MINIO_BUCKET;
  const accessKeyId = env.STORAGE_ACCESS_KEY_ID ?? env.MINIO_ACCESS_KEY;
  const secretAccessKey = env.STORAGE_SECRET_ACCESS_KEY ?? env.MINIO_SECRET_KEY;
  const endpoint = env.STORAGE_ENDPOINT ?? legacyMinioEndpoint();

  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    return null;
  }
  if (isLoopbackEndpoint(endpoint)) {
    return null;
  }

  return {
    bucket,
    endpoint,
    region: env.STORAGE_REGION ?? env.MINIO_REGION ?? 'auto',
    accessKeyId,
    secretAccessKey,
  };
};

export const isImportObjectStorageConfigured = (): boolean =>
  objectStorageConfig() != null;

const getClient = (config: ObjectStorageConfig): S3Client => {
  const signature = JSON.stringify({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
  });

  if (client && clientSignature === signature) {
    return client;
  }

  clientSignature = signature;
  client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
};

const requireConfig = (): ObjectStorageConfig => {
  const config = objectStorageConfig();
  if (!config) {
    throw new AppError('Temporary document storage is not configured.', 503);
  }
  return config;
};

export const createSignedImportObjectUploadIntent = async ({
  filename,
  mimeType,
  userId,
}: {
  filename: string;
  mimeType?: string;
  userId: string;
}): Promise<SignedObjectUploadIntent> => {
  const config = requireConfig();
  const extension = path.extname(filename).toLowerCase();
  const basename =
    sanitizeKeyPart(path.basename(filename, extension)) || 'document';
  const safeUserId = sanitizeKeyPart(userId) || 'user';
  const storageKey = `${DOCUMENT_IMPORT_FOLDER}/${safeUserId}/${Date.now()}-${randomUUID()}-${basename}${extension}`;
  const contentType = mimeType?.trim() || 'application/octet-stream';
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: storageKey,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(getClient(config) as never, command, {
    expiresIn: SIGNED_UPLOAD_EXPIRES_SECONDS,
  });

  return {
    provider: 's3',
    method: 'PUT',
    uploadUrl,
    storageKey,
    expiresAt: new Date(
      (Math.floor(Date.now() / 1000) + SIGNED_UPLOAD_EXPIRES_SECONDS) * 1000,
    ).toISOString(),
    headers: {
      'Content-Type': contentType,
    },
    maxSizeBytes: MAX_DOCUMENT_IMPORT_BYTES,
  };
};

export const isExpectedImportObjectKey = ({
  storageKey,
  userId,
}: {
  storageKey: string;
  userId: string;
}): boolean => {
  const safeUserId = sanitizeKeyPart(userId) || 'user';
  const expectedPrefix = `${DOCUMENT_IMPORT_FOLDER}/${safeUserId}/`;
  return (
    storageKey.startsWith(expectedPrefix) &&
    !storageKey.includes('..') &&
    !storageKey.includes('\\') &&
    storageKey.length > expectedPrefix.length
  );
};

export const createSignedImportObjectReadUrl = async (
  storageKey: string,
): Promise<string> => {
  const config = requireConfig();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: storageKey,
  });
  return getSignedUrl(getClient(config) as never, command, {
    expiresIn: SIGNED_READ_EXPIRES_SECONDS,
  });
};

export const deleteImportObject = async (
  storageKey: string | null | undefined,
): Promise<void> => {
  if (!storageKey) {
    return;
  }

  const config = requireConfig();
  await getClient(config).send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
    }),
  );
};
