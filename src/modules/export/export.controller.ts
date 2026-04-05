import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { ensureCanvasAccess } from '@/shared/utils/access-control';
import fs from 'fs/promises';
import path from 'path';

import { exportService } from './export.service';

export class ExportController {
  async exportPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { canvasId, slideIds } = req.body;
      const canvas = await ensureCanvasAccess(canvasId, req.user!);
      const exportRecord = await prisma.export.create({
        data: { canvasId, userId: req.user!.userId, format: 'PDF', status: 'PENDING' },
      });
      const completedExport = await exportService.generateExport({
        canvas,
        exportId: exportRecord.id,
        format: 'PDF',
        requestedSlideIds: Array.isArray(slideIds) ? slideIds : undefined,
      });
      ApiResponse.created(res, completedExport, 'PDF export completed');
    } catch (error) { next(error); }
  }

  async exportImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { canvasId, format = 'PNG', slideIds } = req.body;
      const normalizedFormat = typeof format === 'string' ? format.toUpperCase() : 'PNG';
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
