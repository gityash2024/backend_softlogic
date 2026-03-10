import path from 'path';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const isAllowedImageType = (mimeType: string): boolean => {
  return ALLOWED_IMAGE_TYPES.includes(mimeType);
};

export const isFileSizeValid = (sizeInBytes: number): boolean => {
  return sizeInBytes <= MAX_FILE_SIZE;
};

export const getFileExtension = (filename: string): string => {
  return path.extname(filename).toLowerCase();
};

export const generateUniqueFilename = (originalName: string): string => {
  const ext = getFileExtension(originalName);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}${ext}`;
};
