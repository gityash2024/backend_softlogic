import multer from 'multer';
import { AppError } from '@/shared/errors/AppError';
import { isAllowedImageType } from '@/shared/utils/file';
import path from 'path';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENT_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const storage = multer.memoryStorage();
const documentMimeTypes = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);
const documentExtensions = new Set<string>(['.pdf', '.pptx', '.ppt']);

const isAllowedDocumentImportType = (file: Express.Multer.File): boolean => {
  const extension = path.extname(file.originalname).toLowerCase();
  return documentMimeTypes.has(file.mimetype) || documentExtensions.has(extension);
};

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

export const uploadDocumentSingle = (fieldName: string) =>
  multer({
    storage,
    limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (isAllowedDocumentImportType(file)) {
        cb(null, true);
      } else {
        cb(
          new AppError(
            'Invalid file type. Only PDF and PowerPoint files are allowed.',
            400,
          ),
        );
      }
    },
  }).single(fieldName);
