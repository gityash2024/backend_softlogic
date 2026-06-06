import { Request, Response, NextFunction } from 'express';
import { ContentImportStatus, ExportFormat, ExportStatus } from '@prisma/client';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { ensureCanvasAccess } from '@/shared/utils/access-control';
import { logger } from '@/shared/middleware/logger.middleware';
import { fileStorageService } from '@/shared/services/file-storage.service';
import { writeAuditLog } from '@/shared/utils/audit';
import fs from 'fs/promises';
import path from 'path';

import { exportService } from './export.service';
import { importConversionService } from './import-conversion.service';
import {
  createSignedRawUploadIntent,
  deleteRawAsset,
} from '@/shared/services/cloudinary.service';
import {
  createSignedImportObjectUploadIntent,
  isImportObjectStorageConfigured,
  MAX_DOCUMENT_IMPORT_BYTES,
} from '@/shared/services/import-temp-storage.service';

type ExportQualityInput = 'LOW' | 'MEDIUM' | 'HIGH';
type ExportResolutionInput = 'STANDARD' | 'HD' | 'ULTRA';
const MAX_CLIENT_EXPORT_BYTES = 500 * 1024 * 1024;

const sanitizeKeyPart = (value: string | null | undefined): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const contentStoragePrefix = ({
  root,
  organizationId,
  role,
  userId,
}: {
  root: 'exports' | 'imports';
  organizationId?: string | null;
  role?: string | null;
  userId: string;
}): string =>
  [
    root,
    sanitizeKeyPart(organizationId) || 'no-org',
    sanitizeKeyPart(role) || 'role',
    sanitizeKeyPart(userId) || 'user',
  ].join('/');

const normalizeExportQuality = (value: unknown): ExportQualityInput => {
  if (typeof value !== 'string') {
    return 'HIGH';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'LOW' || normalized === 'MEDIUM' || normalized === 'HIGH') {
    return normalized;
  }

  throw new AppError('Export quality must be LOW, MEDIUM, or HIGH', 400);
};

const normalizeExportResolution = (value: unknown): ExportResolutionInput => {
  if (typeof value !== 'string') {
    return 'HD';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'STANDARD' || normalized === 'HD' || normalized === 'ULTRA') {
    return normalized;
  }

  throw new AppError('Export resolution must be STANDARD, HD, or ULTRA', 400);
};

const normalizeClientExportFormat = (value: unknown): ExportFormat => {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (['PDF', 'PNG', 'JPG', 'SVG'].includes(normalized)) {
    return normalized as ExportFormat;
  }
  throw new AppError('Export format must be PDF, PNG, JPG, or SVG', 400);
};

const normalizeClientExportStatus = (value: unknown): ExportStatus => {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : 'COMPLETED';
  if (normalized === 'COMPLETED' || normalized === 'FAILED') {
    return normalized as ExportStatus;
  }
  throw new AppError('Client export status must be COMPLETED or FAILED', 400);
};

const getImportMetadata = (body: Request['body']): Record<string, string> => {
  const metadataKeys = [
    'sourceExtension',
    'renderMode',
    'conversionMode',
    'extractEmbeddedImages',
  ];
  return Object.fromEntries(
    metadataKeys.flatMap((key) => {
      const value = body[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return [];
      }
      return [[key, value.trim()]];
    }),
  );
};

const normalizeDocumentImportRequest = (body: Request['body']) => {
  const sourceName =
    typeof body.sourceName === 'string' ? body.sourceName.trim() : '';
  const sourceExtension =
    typeof body.sourceExtension === 'string'
      ? body.sourceExtension.trim().toLowerCase().replace(/^\./, '')
      : '';
  const mimeType =
    typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
  const sizeBytes = Number(body.sizeBytes);
  const extension = sourceExtension || path.extname(sourceName).toLowerCase().replace(/^\./, '');

  if (!sourceName) {
    throw new AppError('Source name is required.', 400);
  }
  if (extension !== 'pdf' && extension !== 'ppt' && extension !== 'pptx') {
    throw new AppError(
      'Only PDF and PowerPoint files can use remote import upload.',
      400,
      true,
      'IMPORT_UNSUPPORTED_TYPE',
    );
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new AppError('The selected file is empty.', 400, true, 'IMPORT_EMPTY_FILE');
  }
  if (sizeBytes > MAX_DOCUMENT_IMPORT_BYTES) {
    throw new AppError(
      'File size should not be more than 50 MB.',
      413,
      true,
      'IMPORT_FILE_TOO_LARGE',
    );
  }
  const normalizedMimeType = mimeType.toLowerCase();
  const mimeMatches =
    !normalizedMimeType ||
    normalizedMimeType === 'application/octet-stream' ||
    (extension === 'pdf' && normalizedMimeType === 'application/pdf') ||
    (extension === 'ppt' &&
      normalizedMimeType === 'application/vnd.ms-powerpoint') ||
    (extension === 'pptx' &&
      normalizedMimeType ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  if (!mimeMatches) {
    throw new AppError(
      'The document MIME type does not match its file type.',
      400,
      true,
      'IMPORT_UNSUPPORTED_TYPE',
    );
  }

  return {
    sourceName,
    sourceExtension: extension,
    mimeType,
    sizeBytes,
  };
};

const publicIdPrefix = (publicId: string): string =>
  publicId.split('/').slice(0, 4).join('/');

export class ExportController {
  async createClientUploadIntent(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const fileName =
        typeof req.body.fileName === 'string' ? req.body.fileName.trim() : '';
      const mimeType =
        typeof req.body.mimeType === 'string'
          ? req.body.mimeType.trim()
          : 'application/octet-stream';
      const sizeBytes = Number(req.body.sizeBytes);

      if (!fileName) {
        throw new AppError('File name is required', 400);
      }
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new AppError('Export file size is required', 400);
      }
      if (sizeBytes > MAX_CLIENT_EXPORT_BYTES) {
        throw new AppError('Export file size is too large', 413);
      }

      const requestedCanvasId =
        typeof req.body.canvasId === 'string' ? req.body.canvasId.trim() : '';
      const organizationId = requestedCanvasId
        ? (await ensureCanvasAccess(requestedCanvasId, req.user!)).organizationId
        : req.user!.organizationId;

      const intent = await fileStorageService.createSignedUploadIntent({
        prefix: contentStoragePrefix({
          root: 'exports',
          organizationId,
          role: req.user!.role,
          userId: req.user!.userId,
        }),
        fileName,
        mimeType,
        maxSizeBytes: MAX_CLIENT_EXPORT_BYTES,
      });
      ApiResponse.success(res, intent, 'Client export upload intent created');
    } catch (error) {
      next(error);
    }
  }

  async completeClientExport(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const canvasId =
        typeof req.body.canvasId === 'string' ? req.body.canvasId.trim() : '';
      if (!canvasId) {
        throw new AppError('Canvas id is required', 400);
      }
      await ensureCanvasAccess(canvasId, req.user!);

      const format = normalizeClientExportFormat(req.body.format);
      const status = normalizeClientExportStatus(req.body.status);
      const storageKey =
        typeof req.body.storageKey === 'string' ? req.body.storageKey.trim() : '';
      const suppliedUrl =
        typeof req.body.fileUrl === 'string' ? req.body.fileUrl.trim() : '';
      const fileName =
        typeof req.body.fileName === 'string' && req.body.fileName.trim()
          ? req.body.fileName.trim()
          : storageKey
            ? path.basename(storageKey)
            : null;
      const mimeType =
        typeof req.body.mimeType === 'string' && req.body.mimeType.trim()
          ? req.body.mimeType.trim()
          : exportService.getMimeType(format);
      const fileUrl = suppliedUrl || (storageKey ? fileStorageService.publicUrlFor(storageKey) : '');
      const fileSize = Number(req.body.fileSize);

      if (status === ExportStatus.COMPLETED && !fileUrl) {
        throw new AppError('Completed client exports require a file URL', 400);
      }

      const exportRecord = await prisma.export.create({
        data: {
          canvasId,
          userId: req.user!.userId,
          format,
          status,
          fileUrl: fileUrl || null,
          storageKey: storageKey || null,
          mimeType,
          fileName,
          fileSize: Number.isFinite(fileSize) && fileSize > 0 ? Math.floor(fileSize) : null,
          completedAt: status === ExportStatus.COMPLETED ? new Date() : null,
        },
      });

      await writeAuditLog({
        actorUserId: req.user!.userId,
        action:
          status === ExportStatus.COMPLETED
            ? 'classroom.export.completed'
            : 'classroom.export.failed',
        targetType: 'canvas',
        targetId: canvasId,
        summary:
          status === ExportStatus.COMPLETED
            ? `${format} export completed`
            : `${format} export failed`,
        ip: req.ip,
        metadata: {
          exportId: exportRecord.id,
          format,
          fileUrl: fileUrl || null,
          storageKey: storageKey || null,
        },
      });

      ApiResponse.created(res, exportRecord, 'Client export recorded');
    } catch (error) {
      next(error);
    }
  }

  async createImportUploadIntent(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const input = normalizeDocumentImportRequest(req.body);
      const useObjectStorage = isImportObjectStorageConfigured();
      const intent = useObjectStorage
        ? await createSignedImportObjectUploadIntent({
            filename: input.sourceName,
            mimeType: input.mimeType,
            userId: req.user!.userId,
            userRole: req.user!.role,
            organizationId: req.user!.organizationId,
          })
        : createSignedRawUploadIntent({
            filename: input.sourceName,
            userId: req.user!.userId,
          });
      let importRecordId: string | null = null;
      if (useObjectStorage && 'storageKey' in intent) {
        const importRecord = await prisma.contentImport.create({
          data: {
            userId: req.user!.userId,
            userRole: req.user!.role,
            organizationId: req.user!.organizationId ?? null,
            sourceName: input.sourceName,
            mimeType: input.mimeType || null,
            sizeBytes: Math.floor(input.sizeBytes),
            storageKey: intent.storageKey,
            publicUrl: fileStorageService.publicUrlFor(intent.storageKey),
            status: ContentImportStatus.PENDING,
            metadata: getImportMetadata(req.body),
          },
        });
        importRecordId = importRecord.id;
      }
      logger.info('import.upload-intent.created', {
        provider: 'provider' in intent ? intent.provider : 'cloudinary',
        sourceExtension: input.sourceExtension,
        sizeBytes: input.sizeBytes,
        publicIdPrefix: 'publicId' in intent ? publicIdPrefix(intent.publicId) : '',
        storageKeyPrefix:
          'storageKey' in intent ? publicIdPrefix(intent.storageKey) : '',
      });

      ApiResponse.success(
        res,
        importRecordId ? { ...intent, importRecordId } : intent,
        'Document import upload intent created',
      );
    } catch (error) {
      next(error);
    }
  }

  async convertImportDocument(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      if (!req.file) {
        throw new AppError('Document file is required.', 400);
      }
      const requestedType =
        typeof req.body.type === 'string' ? req.body.type.trim().toLowerCase() : '';
      if (requestedType !== 'pdf' && requestedType !== 'ppt' && requestedType !== 'pptx') {
        throw new AppError('Import type must be either pdf, ppt, or pptx.', 400);
      }
      const normalizedType = requestedType === 'pdf' ? 'pdf' : 'ppt';

      const result = await importConversionService.convertDocument({
        requestedType: normalizedType,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        metadata: getImportMetadata(req.body),
      });
      logger.info('import.convert-multipart.complete', {
        format: result.format,
        sizeBytes: req.file.size,
        pageCount: result.pages.length,
        durationMs: Date.now() - startedAt,
      });

      ApiResponse.success(res, result, 'Document import converted');
    } catch (error) {
      logger.warn('import.convert-multipart.failed', {
        durationMs: Date.now() - startedAt,
        failureCode: error instanceof AppError ? error.code : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  }

  async convertRemoteImportDocument(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const startedAt = Date.now();
    const publicId =
      typeof req.body.publicId === 'string' ? req.body.publicId.trim() : '';
    const storageKey =
      typeof req.body.storageKey === 'string' ? req.body.storageKey.trim() : '';
    let requestedType = '';
    let sourceName = '';
    const requestedSizeBytes = Number(req.body.sizeBytes);
    try {
      requestedType =
        typeof req.body.type === 'string' ? req.body.type.trim().toLowerCase() : '';
      if (requestedType !== 'pdf' && requestedType !== 'ppt' && requestedType !== 'pptx') {
        throw new AppError(
          'Import type must be pdf, ppt, or pptx.',
          400,
          true,
          'IMPORT_UNSUPPORTED_TYPE',
        );
      }
      sourceName =
        typeof req.body.sourceName === 'string' ? req.body.sourceName.trim() : '';
      const fileUrl =
        typeof req.body.fileUrl === 'string' ? req.body.fileUrl.trim() : '';
      if (!sourceName) {
        throw new AppError('Source name is required.', 400);
      }
      if (!fileUrl && !storageKey) {
        throw new AppError('Remote file URL is required.', 400);
      }

      logger.info('import.convert-remote.start', {
        requestedType,
        sourceName,
        sizeBytes: Number.isFinite(requestedSizeBytes)
          ? requestedSizeBytes
          : undefined,
        publicIdPrefix: publicId ? publicIdPrefix(publicId) : '',
        storageKeyPrefix: storageKey ? publicIdPrefix(storageKey) : '',
      });
      if (storageKey) {
        await prisma.contentImport.updateMany({
          where: { storageKey, userId: req.user!.userId },
          data: {
            status: ContentImportStatus.PROCESSING,
            error: null,
          },
        });
      }
      const result = await importConversionService.convertRemoteDocument({
        requestedType,
        fileName: sourceName,
        fileUrl,
        publicId,
        storageKey,
        userId: req.user!.userId,
      });
      logger.info('import.convert-remote.complete', {
        format: result.format,
        pageCount: result.pages.length,
        sizeBytes: Number.isFinite(requestedSizeBytes)
          ? requestedSizeBytes
          : undefined,
        durationMs: Date.now() - startedAt,
        publicIdPrefix: publicId ? publicIdPrefix(publicId) : '',
        storageKeyPrefix: storageKey ? publicIdPrefix(storageKey) : '',
      });
      if (storageKey) {
        await prisma.contentImport.updateMany({
          where: { storageKey, userId: req.user!.userId },
          data: {
            status: ContentImportStatus.CONVERTED,
            convertedAt: new Date(),
            error: null,
          },
        });
      }

      ApiResponse.success(res, result, 'Document import converted');
    } catch (error) {
      if (storageKey) {
        await prisma.contentImport.updateMany({
          where: { storageKey, userId: req.user!.userId },
          data: {
            status: ContentImportStatus.FAILED,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      logger.warn('import.convert-remote.failed', {
        requestedType,
        sourceName,
        sizeBytes: Number.isFinite(requestedSizeBytes)
          ? requestedSizeBytes
          : undefined,
        durationMs: Date.now() - startedAt,
        failureCode: error instanceof AppError ? error.code : undefined,
        error: error instanceof Error ? error.message : String(error),
        publicIdPrefix: publicId ? publicIdPrefix(publicId) : '',
        storageKeyPrefix: storageKey ? publicIdPrefix(storageKey) : '',
      });
      next(error);
    } finally {
      if (!storageKey && publicId) {
        try {
          await deleteRawAsset(publicId);
          logger.info('import.raw-cleanup.complete', {
            publicIdPrefix: publicIdPrefix(publicId),
          });
        } catch (cleanupError) {
          logger.warn('import.raw-cleanup.failed', {
            publicIdPrefix: publicIdPrefix(publicId),
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        }
      }
    }
  }

  async exportPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { canvasId, slideIds } = req.body;
      const canvas = await ensureCanvasAccess(canvasId, req.user!);
      const options = {
        quality: normalizeExportQuality(req.body.quality),
        resolution: normalizeExportResolution(req.body.resolution),
      };
      const exportRecord = await prisma.export.create({
        data: { canvasId, userId: req.user!.userId, format: 'PDF', status: 'PENDING' },
      });
      const completedExport = await exportService.generateExport({
        canvas,
        exportId: exportRecord.id,
        format: 'PDF',
        options,
        requestedSlideIds: Array.isArray(slideIds) ? slideIds : undefined,
      });
      ApiResponse.created(res, completedExport, 'PDF export completed');
    } catch (error) { next(error); }
  }

  async exportImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { canvasId, format = 'PNG', slideIds } = req.body;
      const normalizedFormat = typeof format === 'string' ? format.toUpperCase() : 'PNG';
      const options = {
        quality: normalizeExportQuality(req.body.quality),
        resolution: normalizeExportResolution(req.body.resolution),
      };
      if (!['PNG', 'JPG'].includes(normalizedFormat)) {
        throw new AppError('Only PNG and JPG exports are supported', 400);
      }
      const canvas = await ensureCanvasAccess(canvasId, req.user!);
      const exportRecord = await prisma.export.create({
        data: {
          canvasId,
          userId: req.user!.userId,
          format: normalizedFormat as 'PNG' | 'JPG',
          status: 'PENDING',
        },
      });
      const completedExport = await exportService.generateExport({
        canvas,
        exportId: exportRecord.id,
        format: normalizedFormat as 'PNG' | 'JPG',
        options,
        requestedSlideIds: Array.isArray(slideIds) ? slideIds : undefined,
      });
      ApiResponse.created(res, completedExport, 'Image export completed');
    } catch (error) { next(error); }
  }

  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const exportRecord = await prisma.export.findFirst({
        where: req.user!.role === 'SUPER_ADMIN'
          ? { id: req.params.id }
          : { id: req.params.id, userId: req.user!.userId },
      });
      if (!exportRecord) throw new AppError('Export not found', 404);
      ApiResponse.success(res, exportRecord);
    } catch (error) { next(error); }
  }

  async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const exportRecord = await prisma.export.findFirst({
        where: req.user!.role === 'SUPER_ADMIN'
          ? { id: req.params.id }
          : { id: req.params.id, userId: req.user!.userId },
      });
      if (!exportRecord) throw new AppError('Export not found', 404);
      if (exportRecord.status !== 'COMPLETED' || !exportRecord.fileUrl) {
        throw new AppError('Export not ready for download', 400);
      }
      const resolvedPath = path.resolve(exportRecord.fileUrl);
      await fs.access(resolvedPath);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportService.getDownloadName(exportRecord)}"`,
      );
      res.type(exportService.getMimeType(exportRecord.format));
      res.sendFile(resolvedPath, (error) => {
        if (error) {
          next(error);
        }
      });
    } catch (error) { next(error); }
  }
}

export const exportController = new ExportController();
