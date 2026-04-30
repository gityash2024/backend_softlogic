import { AppError } from '@/shared/errors/AppError';
import { fileStorageService } from '@/shared/services/file-storage.service';

export class MediaService {
  async upload(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new AppError('File is required', 400);
    }
    return fileStorageService.storeFile(`media/${userId}`, file);
  }
}

export const mediaService = new MediaService();
