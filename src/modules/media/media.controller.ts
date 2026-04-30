import { NextFunction, Request, Response } from 'express';
import { mediaService } from './media.service';
import { ApiResponse } from '@/shared/utils/api-response';

export class MediaController {
  async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const media = await mediaService.upload(req.user!.userId, req.file);
      ApiResponse.created(res, media, 'Media uploaded');
    } catch (error) {
      next(error);
    }
  }
}

export const mediaController = new MediaController();
