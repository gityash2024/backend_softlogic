import { AppError } from '@/shared/errors/AppError';
import { fileStorageService } from '@/shared/services/file-storage.service';

export const MAX_MEDIA_UPLOAD_BYTES = 250 * 1024 * 1024;

export interface MediaUploadIntentInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const sanitizeKeyPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const supportedDocumentMimeTypes = new Set([
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const isSupportedMediaMimeType = (mimeType: string): boolean =>
  /^(image|audio|video)\//.test(mimeType) ||
  supportedDocumentMimeTypes.has(mimeType);

export class MediaService {
  async upload(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new AppError('File is required', 400);
    }
    return fileStorageService.storeFile(`media/${userId}`, file);
  }

  async createUploadIntent(userId: string, input: MediaUploadIntentInput) {
    const fileName = input.fileName?.trim();
    const mimeType = input.mimeType?.trim().toLowerCase();
    const sizeBytes = Number(input.sizeBytes);

    if (!fileName) {
      throw new AppError('File name is required', 400);
    }
    if (!mimeType || !isSupportedMediaMimeType(mimeType)) {
      throw new AppError('Unsupported media type', 415);
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new AppError('File size is required', 400);
    }
    if (sizeBytes > MAX_MEDIA_UPLOAD_BYTES) {
      throw new AppError('Media uploads support files up to 250 MB', 413);
    }

    const safeUserId = sanitizeKeyPart(userId) || 'user';
    return fileStorageService.createSignedUploadIntent({
      prefix: `media/${safeUserId}`,
      fileName,
      mimeType,
      maxSizeBytes: MAX_MEDIA_UPLOAD_BYTES,
    });
  }

  async readObject(storageKey: string) {
    return fileStorageService.readFile(storageKey);
  }
}

export const mediaService = new MediaService();
