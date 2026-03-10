import multer from 'multer';
import { AppError } from '@/shared/errors/AppError';
import { isAllowedImageType } from '@/shared/utils/file';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

export const uploadSingle = (fieldName: string) =>
  multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (isAllowedImageType(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new AppError('Invalid file type. Only images are allowed.', 400));
      }
    },
  }).single(fieldName);

export const uploadMultiple = (fieldName: string, maxCount = 5) =>
  multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (isAllowedImageType(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new AppError('Invalid file type. Only images are allowed.', 400));
      }
    },
  }).array(fieldName, maxCount);
