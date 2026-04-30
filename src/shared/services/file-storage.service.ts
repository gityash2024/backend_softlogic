import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';

export interface StoredFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  publicUrl: string;
}

const sanitizeFileName = (fileName: string): string =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

export class FileStorageService {
  private s3Client?: S3Client;

  async storeFile(prefix: string, file: Express.Multer.File): Promise<StoredFile> {
    const safeName = sanitizeFileName(file.originalname);
    const storageKey = `${prefix.replace(/^\/+|\/+$/g, '')}/${randomUUID()}-${safeName}`;

    if (this.shouldUseObjectStorage()) {
      await this.storeInObjectStorage(storageKey, file);
    } else {
      await this.storeLocally(storageKey, file);
    }

    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storageKey,
      publicUrl: this.publicUrlFor(storageKey),
    };
  }

  publicUrlFor(storageKey: string): string {
    if (env.STORAGE_PUBLIC_BASE_URL) {
      return `${env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${storageKey}`;
    }
    return `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/storage/${storageKey}`;
  }

  private async storeLocally(storageKey: string, file: Express.Multer.File): Promise<void> {
    const outputPath = path.resolve(process.cwd(), 'storage', storageKey);
    const storageRoot = path.resolve(process.cwd(), 'storage');
    if (!outputPath.startsWith(storageRoot)) {
      throw new AppError('Invalid storage key', 400);
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.buffer);
  }

  private async storeInObjectStorage(
    storageKey: string,
    file: Express.Multer.File,
  ): Promise<void> {
    if (!env.STORAGE_BUCKET) {
      throw new AppError('STORAGE_BUCKET is required for object storage', 500);
    }

    await this.getS3Client().send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
  }

  private shouldUseObjectStorage(): boolean {
    return Boolean(
      env.STORAGE_TYPE === 's3' ||
        (env.STORAGE_ENDPOINT &&
          env.STORAGE_ACCESS_KEY_ID &&
          env.STORAGE_SECRET_ACCESS_KEY &&
          env.STORAGE_BUCKET),
    );
  }

  private getS3Client(): S3Client {
    if (!env.STORAGE_ACCESS_KEY_ID || !env.STORAGE_SECRET_ACCESS_KEY) {
      throw new AppError('Object storage credentials are not configured', 500);
    }

    this.s3Client ??= new S3Client({
      region: env.STORAGE_REGION ?? 'auto',
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: Boolean(env.STORAGE_ENDPOINT),
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
    });
    return this.s3Client;
  }
}

export const fileStorageService = new FileStorageService();
