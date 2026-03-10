import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';

export class SlidesController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: canvasId } = req.params;
      // Verify canvas ownership
      const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId: req.user!.userId, deletedAt: null } });
      if (!canvas) throw new AppError('Canvas not found', 404);

      const slides = await prisma.slide.findMany({ where: { canvasId }, orderBy: { order: 'asc' } });
      ApiResponse.success(res, slides);
    } catch (error) { next(error); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: canvasId } = req.params;
      const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId: req.user!.userId, deletedAt: null } });
      if (!canvas) throw new AppError('Canvas not found', 404);

      const maxOrder = await prisma.slide.aggregate({ where: { canvasId }, _max: { order: true } });
      const newOrder = (maxOrder._max.order ?? -1) + 1;

      const slide = await prisma.slide.create({
        data: { canvasId, order: newOrder, name: `Slide ${newOrder + 1}` },
      });
      ApiResponse.created(res, slide, 'Slide created');
    } catch (error) { next(error); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: canvasId, sid: slideId } = req.params;
      const slide = await prisma.slide.findFirst({ where: { id: slideId, canvasId } });
      if (!slide) throw new AppError('Slide not found', 404);
      ApiResponse.success(res, slide);
    } catch (error) { next(error); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: canvasId, sid: slideId } = req.params;
      const { elements, name, thumbnail } = req.body;

      const slide = await prisma.slide.findFirst({ where: { id: slideId, canvasId } });
      if (!slide) throw new AppError('Slide not found', 404);

      const updated = await prisma.slide.update({
        where: { id: slideId },
        data: { elements: elements ?? undefined, name: name ?? undefined, thumbnail: thumbnail ?? undefined },
      });
      ApiResponse.success(res, updated, 'Slide updated');
    } catch (error) { next(error); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: canvasId, sid: slideId } = req.params;
      const slide = await prisma.slide.findFirst({ where: { id: slideId, canvasId } });
      if (!slide) throw new AppError('Slide not found', 404);

      await prisma.slide.delete({ where: { id: slideId } });
      ApiResponse.success(res, null, 'Slide deleted');
    } catch (error) { next(error); }
  }

  async reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: canvasId } = req.params;
      const { slideIds } = req.body; // Array of slide IDs in new order

      if (!Array.isArray(slideIds)) throw new AppError('slideIds must be an array', 400);

      const updates = slideIds.map((slideId: string, index: number) =>
        prisma.slide.update({ where: { id: slideId }, data: { order: index } })
      );
      await prisma.$transaction(updates);

      ApiResponse.success(res, null, 'Slides reordered');
    } catch (error) { next(error); }
  }
}

export const slidesController = new SlidesController();
