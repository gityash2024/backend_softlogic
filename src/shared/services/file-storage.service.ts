import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat, writeFile } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/config';
import { AppError } from '@/shared/errors/AppError';

export interface StoredFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  publicUrl: string;
}

export interface SignedFileUploadIntent {
  provider: 's3';
  method: 'PUT';
  uploadUrl: string;
  publicUrl: string;
  storageKey: string;
  expiresAt: string;
  headers: Record<string, string>;
  maxSizeBytes: number;
}

export interface StoredFileReadStream {
  body: Readable;
  mimeType: string;
  sizeBytes?: number;
}

const SIGNED_UPLOAD_EXPIRES_SECONDS = 10 * 60;

const sanitizeFileName = (fileName: string): string =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

export class FileStorageService {
  private s3Client?: S3Client;

  async createSignedUploadIntent({
    prefix,
    fileName,
    mimeType,
    maxSizeBytes,
  }: {
    prefix: string;
    fileName: string;
    mimeType: string;
    maxSizeBytes: number;
  }): Promise<SignedFileUploadIntent> {
    if (!this.shouldUseObjectStorage() || !env.STORAGE_BUCKET) {
      throw new AppError('Object storage is not configured', 503);
    }

    const safeName = sanitizeFileName(fileName) || 'media';
    const storageKey = `${prefix.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${randomUUID()}-${safeName}`;
    const command = new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(this.getS3Client() as never, command, {
      expiresIn: SIGNED_UPLOAD_EXPIRES_SECONDS,
    });

    return {
      provider: 's3',
      method: 'PUT',
      uploadUrl,
      publicUrl: this.publicUrlFor(storageKey),
      storageKey,
      expiresAt: new Date(
        (Math.floor(Date.now() / 1000) + SIGNED_UPLOAD_EXPIRES_SECONDS) * 1000,
      ).toISOString(),
      headers: {
        'Content-Type': mimeType,
      },
      maxSizeBytes,
    };
  }

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

  async readFile(storageKey: string): Promise<StoredFileReadStream> {
    const normalizedKey = storageKey.replace(/^\/+/, '');
    if (
      !normalizedKey.startsWith('media/') ||
      normalizedKey.includes('..') ||
      normalizedKey.includes('\\')
    ) {
      throw new AppError('Invalid media key', 400);
    }

    if (this.shouldUseObjectStorage()) {
      return this.readFromObjectStorage(normalizedKey);
    }
    return this.readLocally(normalizedKey);
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

  private async readLocally(storageKey: string): Promise<StoredFileReadStream> {
    const outputPath = path.resolve(process.cwd(), 'storage', storageKey);
    const storageRoot = path.resolve(process.cwd(), 'storage');
    if (!outputPath.startsWith(storageRoot)) {
      throw new AppError('Invalid storage key', 400);
    }
    const fileStats = await stat(outputPath);
    return {
      body: createReadStream(outputPath),
      mimeType: this.mimeTypeForPath(storageKey),
      sizeBytes: fileStats.size,
    };
  }

  private async readFromObjectStorage(
    storageKey: string,
  ): Promise<StoredFileReadStream> {
    if (!env.STORAGE_BUCKET) {
      throw new AppError('STORAGE_BUCKET is required for object storage', 500);
    }
    const object = await this.getS3Client().send(
      new GetObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: storageKey,
      }),
    );
    const body = object.Body;
    if (!body || !(body instanceof Readable)) {
      throw new AppError('Media object could not be read', 502);
    }
    return {
      body,
      mimeType: object.ContentType ?? this.mimeTypeForPath(storageKey),
      sizeBytes: object.ContentLength,
    };
  }

  private mimeTypeForPath(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.bmp':
        return 'image/bmp';
      case '.svg':
        return 'image/svg+xml';
      case '.mp3':
        return 'audio/mpeg';
      case '.wav':
        return 'audio/wav';
      case '.m4a':
        return 'audio/mp4';
      case '.aac':
        return 'audio/aac';
      case '.ogg':
        return 'audio/ogg';
      case '.mp4':
        return 'video/mp4';
      case '.mov':
        return 'video/quicktime';
      case '.avi':
        return 'video/x-msvideo';
      case '.mkv':
        return 'video/x-matroska';
      case '.webm':
        return 'video/webm';
      default:
        return 'application/octet-stream';
    }
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
