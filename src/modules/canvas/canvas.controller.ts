import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { getSkipTake, getPaginationMeta, paginationSchema } from '@/shared/utils/pagination';
import { ensureCanvasAccess, getAccessibleOrganizationIds } from '@/shared/utils/access-control';

export class CanvasController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, perPage } = paginationSchema.parse(req.query);
      const { skip, take } = getSkipTake(page, perPage);
      const accessibleOrganizationIds = await getAccessibleOrganizationIds(req.user!);
      const where = accessibleOrganizationIds === null
        ? { deletedAt: null }
        : {
            deletedAt: null,
            OR: [
              { userId: req.user!.userId },
              ...(accessibleOrganizationIds.length > 0
                ? [{ organizationId: { in: accessibleOrganizationIds } }]
                : []),
            ],
          };

      const [canvases, total] = await Promise.all([
        prisma.canvas.findMany({ where, skip, take, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { slides: true } } } }),
        prisma.canvas.count({ where }),
      ]);

      ApiResponse.paginated(res, canvases, total, page, perPage);
    } catch (error) { next(error); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, description, metadata } = req.body;
      const organizationId = req.user?.organizationId ?? null;
      const canvas = await prisma.canvas.create({
        data: {
          userId: req.user!.userId,
          organizationId,
          name: name || 'Untitled Canvas',
          description,
          metadata: metadata ?? undefined,
          slides: { create: { order: 0, name: 'Slide 1' } },
        },
        include: { slides: true },
      });
      ApiResponse.created(res, canvas, 'Canvas created');
    } catch (error) { next(error); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const canvas = await ensureCanvasAccess(req.params.id, req.user!);
      ApiResponse.success(res, canvas);
    } catch (error) { next(error); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await ensureCanvasAccess(req.params.id, req.user!);
      const { name, description, metadata, thumbnail } = req.body;
      const canvas = await prisma.canvas.updateMany({
        where: { id: req.params.id },
        data: {
          name,
          description,
          thumbnail,
          metadata: metadata ?? undefined,
        },
      });
      if (canvas.count === 0) throw new AppError('Canvas not found', 404);
      const updated = await prisma.canvas.findUnique({ where: { id: req.params.id } });
      ApiResponse.success(res, updated, 'Canvas updated');
    } catch (error) { next(error); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await ensureCanvasAccess(req.params.id, req.user!);
      const result = await prisma.canvas.updateMany({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new AppError('Canvas not found', 404);
      ApiResponse.success(res, null, 'Canvas deleted');
    } catch (error) { next(error); }
  }
}

export const canvasController = new CanvasController();
