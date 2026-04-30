import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
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
}

export const classroomController = new ClassroomController();
