import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { ensureCanvasAccess } from '@/shared/utils/access-control';
import fs from 'fs/promises';
import path from 'path';

import { exportService } from './export.service';
import { importConversionService } from './import-conversion.service';

type ExportQualityInput = 'LOW' | 'MEDIUM' | 'HIGH';
type ExportResolutionInput = 'STANDARD' | 'HD' | 'ULTRA';

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

export class ExportController {
  async convertImportDocument(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.file) {
        throw new AppError('Document file is required.', 400);
      }
      const requestedType =
        typeof req.body.type === 'string' ? req.body.type.trim().toLowerCase() : '';
      if (requestedType !== 'pdf' && requestedType !== 'ppt') {
        throw new AppError('Import type must be either pdf or ppt.', 400);
      }

      const result = await importConversionService.convertDocument({
        requestedType,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      ApiResponse.success(res, result, 'Document import converted');
    } catch (error) {
      next(error);
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
