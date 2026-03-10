import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';

export class ExportController {
  async exportPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { canvasId, slideIds } = req.body;
      const exportRecord = await prisma.export.create({
        data: { canvasId, userId: req.user!.userId, format: 'PDF', status: 'PENDING' },
      });
      // TODO: Queue PDF generation job
      ApiResponse.created(res, exportRecord, 'PDF export initiated');
    } catch (error) { next(error); }
  }

  async exportImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { canvasId, format = 'PNG', quality } = req.body;
      const exportRecord = await prisma.export.create({
        data: { canvasId, userId: req.user!.userId, format, status: 'PENDING' },
      });
      // TODO: Queue image generation job
      ApiResponse.created(res, exportRecord, 'Image export initiated');
    } catch (error) { next(error); }
  }

  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const exportRecord = await prisma.export.findUnique({ where: { id: req.params.id } });
      if (!exportRecord) throw new AppError('Export not found', 404);
      ApiResponse.success(res, exportRecord);
    } catch (error) { next(error); }
  }

  async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const exportRecord = await prisma.export.findUnique({ where: { id: req.params.id } });
      if (!exportRecord) throw new AppError('Export not found', 404);
      if (exportRecord.status !== 'COMPLETED' || !exportRecord.fileUrl) {
        throw new AppError('Export not ready for download', 400);
      }
      ApiResponse.success(res, { downloadUrl: exportRecord.fileUrl });
    } catch (error) { next(error); }
  }
}

export const exportController = new ExportController();
