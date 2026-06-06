import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { getSkipTake, getPaginationMeta, paginationSchema } from '@/shared/utils/pagination';
import {
  canvasAccessMetadata,
  canvasReadWhere,
  ensureCanvasAccess,
  ensureCanvasWriteAccess,
  ensureOrganizationManaged,
  isAdminRole,
} from '@/shared/utils/access-control';

export class CanvasController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, perPage } = paginationSchema.parse(req.query);
      const { skip, take } = getSkipTake(page, perPage);
      const organizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId : '';
      const scopedWhere = await canvasReadWhere(req.user!);
      const where = organizationId
        ? { AND: [scopedWhere, { organizationId }] }
        : scopedWhere;

      const [canvases, total] = await Promise.all([
        prisma.canvas.findMany({
          where,
          skip,
          take,
          orderBy: { updatedAt: 'desc' },
          include: {
            _count: { select: { slides: true } },
            organization: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        }),
        prisma.canvas.count({ where }),
      ]);

      const decoratedCanvases = await Promise.all(
        canvases.map(async (canvas) => ({
          ...canvas,
          access: await canvasAccessMetadata(canvas, req.user!),
        })),
      );

      ApiResponse.paginated(res, decoratedCanvases, total, page, perPage);
    } catch (error) { next(error); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user!.role !== UserRole.TEACHER && !isAdminRole(req.user!.role)) {
        throw new AppError('Only teachers and admins can create whiteboards', 403);
      }

      const { name, description, metadata } = req.body;
      const requestedOrganizationId =
        typeof req.body.organizationId === 'string' && req.body.organizationId.trim().length > 0
          ? req.body.organizationId.trim()
          : null;
      let organizationId = req.user?.organizationId ?? null;

      if (isAdminRole(req.user!.role)) {
        if (requestedOrganizationId) {
          const organization = await ensureOrganizationManaged(requestedOrganizationId, req.user!);
          organizationId = organization.id;
        } else {
          organizationId = req.user?.organizationId ?? null;
        }
      }

      const canvas = await prisma.canvas.create({
        data: {
          userId: req.user!.userId,
          organizationId,
          name: name || 'Untitled Canvas',
          description,
          metadata: metadata ?? undefined,
          slides: { create: { order: 0, name: 'Slide 1' } },
        },
        include: {
          slides: true,
          organization: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });
      ApiResponse.created(
        res,
        { ...canvas, access: await canvasAccessMetadata(canvas, req.user!) },
        'Canvas created',
      );
    } catch (error) { next(error); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const canvas = await ensureCanvasAccess(req.params.id, req.user!);
      ApiResponse.success(
        res,
        { ...canvas, access: await canvasAccessMetadata(canvas, req.user!) },
      );
    } catch (error) { next(error); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await ensureCanvasWriteAccess(req.params.id, req.user!);
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
      const updated = await prisma.canvas.findUnique({
        where: { id: req.params.id },
        include: {
          _count: { select: { slides: true } },
          organization: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });
      ApiResponse.success(
        res,
        updated
          ? { ...updated, access: await canvasAccessMetadata(updated, req.user!) }
          : updated,
        'Canvas updated',
      );
    } catch (error) { next(error); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await ensureCanvasWriteAccess(req.params.id, req.user!);
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
