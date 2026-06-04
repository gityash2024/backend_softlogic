import { NextFunction, Request, Response } from 'express';
import { mediaService } from './media.service';
import { ApiResponse } from '@/shared/utils/api-response';

const mediaObjectUrl = (req: Request, storageKey: string): string => {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}/api/v1/media/object/${encodeURIComponent(storageKey)}`;
};

export class MediaController {
  async createUploadIntent(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const intent = await mediaService.createUploadIntent(
        req.user!.userId,
        req.body,
      );
      ApiResponse.success(
        res,
        {
          ...intent,
          publicUrl: mediaObjectUrl(req, intent.storageKey),
        },
        'Media upload intent created',
      );
    } catch (error) {
      next(error);
    }
  }

  async readObject(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawKey = req.params[0] ?? '';
      const storageKey = decodeURIComponent(rawKey);
      const object = await mediaService.readObject(storageKey);
      res.setHeader('Content-Type', object.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (object.sizeBytes != null) {
        res.setHeader('Content-Length', object.sizeBytes.toString());
      }
      object.body.on('error', next);
      object.body.pipe(res);
    } catch (error) {
      next(error);
    }
  }

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
