import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { AppError } from '@/shared/errors/AppError';
import { classroomService } from './classroom.service';

export class ClassroomController {
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await classroomService.getMe(req.user!);
      ApiResponse.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  async listContentCanvases(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = await classroomService.listContentCanvases(req.user!);
      ApiResponse.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  async getContentCanvas(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = await classroomService.getContentCanvas(
        req.user!,
        req.params.id,
      );
      if (!data) {
        throw new AppError('Canvas not found', 404);
      }
      ApiResponse.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  async listContentActivity(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const limit = Number(req.query.limit);
      const canvasId =
        typeof req.query.canvasId === 'string' ? req.query.canvasId : undefined;
      const data = await classroomService.listContentActivity(req.user!, {
        canvasId,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      ApiResponse.success(res, data);
    } catch (error) {
      next(error);
    }
  }
}

export const classroomController = new ClassroomController();
