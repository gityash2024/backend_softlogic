import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { integrationsService } from './integrations.service';

export class IntegrationsController {
  async googleImages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const results = await integrationsService.searchGoogleImages(
        req.query.q?.toString() ?? '',
      );
      ApiResponse.success(res, results);
    } catch (error) {
      next(error);
    }
  }

  async youtube(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const results = await integrationsService.searchYouTube(
        req.query.q?.toString() ?? '',
      );
      ApiResponse.success(res, results);
    } catch (error) {
      next(error);
    }
  }

  async dropboxOAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, integrationsService.dropboxOAuthUrl(req.user!.userId));
    } catch (error) {
      next(error);
    }
  }

  async dropboxCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await integrationsService.handleDropboxCallback({
        code: req.query.code?.toString(),
        state: req.query.state?.toString(),
        error: req.query.error?.toString(),
      });
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .send(`
          <!doctype html>
          <html lang="en">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>Dropbox connected</title>
              <style>
                body { font-family: Inter, Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f1f5f9; color: #0f172a; }
                main { width: min(520px, calc(100vw - 32px)); padding: 32px; border-radius: 18px; background: #fff; box-shadow: 0 20px 60px rgba(15, 23, 42, .12); text-align: center; }
                h1 { color: #08357c; margin: 0 0 12px; }
                p { color: #475569; line-height: 1.6; margin: 0; }
              </style>
            </head>
            <body>
              <main>
                <h1>Dropbox connected</h1>
                <p>You can close this browser window and return to Softlogic Whiteboard.</p>
              </main>
            </body>
          </html>
        `);
    } catch (error) {
      next(error);
    }
  }

  async dropboxStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await integrationsService.dropboxStatus(req.user!.userId));
    } catch (error) {
      next(error);
    }
  }

  async disconnectDropbox(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await integrationsService.disconnectDropbox(req.user!.userId),
        'Dropbox disconnected',
      );
    } catch (error) {
      next(error);
    }
  }

  async dropboxFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await integrationsService.listDropboxFiles(
          req.user!.userId,
          req.query.path?.toString() ?? '',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async importDropboxFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await integrationsService.importDropboxFile(
          req.user!.userId,
          req.body.path?.toString() ?? '',
        ),
        'Dropbox file imported',
      );
    } catch (error) {
      next(error);
    }
  }

  async lmsStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await integrationsService.lmsStatus(req.user!.userId);
      ApiResponse.success(res, status);
    } catch (error) {
      next(error);
    }
  }

  async createLmsSync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const job = await integrationsService.createLmsSync(req.user!.userId, req.body);
      ApiResponse.created(res, job, 'LMS sync queued');
    } catch (error) {
      next(error);
    }
  }
}

export const integrationsController = new IntegrationsController();
