import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { getSkipTake, getPaginationMeta, paginationSchema } from '@/shared/utils/pagination';

export class CanvasController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, perPage } = paginationSchema.parse(req.query);
      const { skip, take } = getSkipTake(page, perPage);
      const where = { userId: req.user!.userId, deletedAt: null };

      const [canvases, total] = await Promise.all([
        prisma.canvas.findMany({ where, skip, take, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { slides: true } } } }),
        prisma.canvas.count({ where }),
      ]);

      ApiResponse.paginated(res, canvases, total, page, perPage);
    } catch (error) { next(error); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, description } = req.body;
      const canvas = await prisma.canvas.create({
        data: {
          userId: req.user!.userId,
          name: name || 'Untitled Canvas',
          description,
          slides: { create: { order: 0, name: 'Slide 1' } },
        },
        include: { slides: true },
      });
      ApiResponse.created(res, canvas, 'Canvas created');
    } catch (error) { next(error); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const canvas = await prisma.canvas.findFirst({
        where: { id: req.params.id, userId: req.user!.userId, deletedAt: null },
        include: { slides: { orderBy: { order: 'asc' } } },
      });
      if (!canvas) throw new AppError('Canvas not found', 404);
      ApiResponse.success(res, canvas);
    } catch (error) { next(error); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, description } = req.body;
      const canvas = await prisma.canvas.updateMany({
        where: { id: req.params.id, userId: req.user!.userId },
        data: { name, description },
      });
      if (canvas.count === 0) throw new AppError('Canvas not found', 404);
      const updated = await prisma.canvas.findUnique({ where: { id: req.params.id } });
      ApiResponse.success(res, updated, 'Canvas updated');
    } catch (error) { next(error); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await prisma.canvas.updateMany({
        where: { id: req.params.id, userId: req.user!.userId },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new AppError('Canvas not found', 404);
      ApiResponse.success(res, null, 'Canvas deleted');
    } catch (error) { next(error); }
  }
}

export const canvasController = new CanvasController();
