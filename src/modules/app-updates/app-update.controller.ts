import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { appUpdateService } from './app-update.service';
import type {
  CheckAppUpdateQuery,
  ListAppReleasesQuery,
  PublishFullAppReleaseInput,
  UpdateAppReleaseInput,
} from './app-update.validator';

export class AppUpdateController {
  async check(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await appUpdateService.checkForUpdate(
          req.query as unknown as CheckAppUpdateQuery,
        ),
        'App update checked',
      );
    } catch (error) {
      next(error);
    }
  }

  async listReleases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await appUpdateService.listReleases(
          req.user!,
          req.query as unknown as ListAppReleasesQuery,
        ),
        'App releases fetched',
      );
    } catch (error) {
      next(error);
    }
  }

  async publishFullRelease(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await appUpdateService.publishFullRelease(
          req.user!,
          req.body as PublishFullAppReleaseInput,
        ),
        'Full app release published',
      );
    } catch (error) {
      next(error);
    }
  }

  async updateRelease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await appUpdateService.updateRelease(
          req.user!,
          req.params.id,
          req.body as UpdateAppReleaseInput,
        ),
        'App release updated',
      );
    } catch (error) {
      next(error);
    }
  }
}

export const appUpdateController = new AppUpdateController();
