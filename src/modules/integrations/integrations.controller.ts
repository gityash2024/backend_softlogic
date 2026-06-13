import { OrganizationStorageProvider } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';

import { ApiResponse } from '@/shared/utils/api-response';

import { integrationsService } from './integrations.service';

const callbackPage = (provider: string) => `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${provider} connected</title>
      <style>
        body { font-family: Inter, Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f1f5f9; color: #0f172a; }
        main { width: min(520px, calc(100vw - 32px)); padding: 32px; border-radius: 18px; background: #fff; box-shadow: 0 20px 60px rgba(15, 23, 42, .12); text-align: center; }
        h1 { color: #08357c; margin: 0 0 12px; }
        p { color: #475569; line-height: 1.6; margin: 0; }
      </style>
    </head>
    <body>
      <main>
        <h1>${provider} connected</h1>
        <p>You can close this browser window and return to SoftLogic.</p>
      </main>
    </body>
  </html>
`;

const queryOrganizationId = (req: Request): string | undefined =>
  req.query.organizationId?.toString();

const bodyOrganizationId = (req: Request): string | undefined =>
  req.body?.organizationId?.toString();

export class IntegrationsController {
  async googleImages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await integrationsService.searchGoogleImages(req.query.q?.toString() ?? ''),
      );
    } catch (error) {
      next(error);
    }
  }

  async youtube(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await integrationsService.searchYouTube(req.query.q?.toString() ?? ''),
      );
    } catch (error) {
      next(error);
    }
  }

  async dropboxOAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        integrationsService.dropboxOAuthUrl(req.user!.userId, organizationId),
      );
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
        .send(callbackPage('Dropbox'));
    } catch (error) {
      next(error);
    }
  }

  async dropboxStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.dropboxStatus(req.user!.userId, organizationId),
      );
    } catch (error) {
      next(error);
    }
  }

  async disconnectDropbox(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        bodyOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.disconnectDropbox(req.user!.userId, organizationId),
        'Dropbox disconnected',
      );
    } catch (error) {
      next(error);
    }
  }

  async dropboxFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.listDropboxFiles(
          req.user!.userId,
          req.query.path?.toString() ?? '',
          organizationId,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async importDropboxFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.importDropboxFile(
          req.user!.userId,
          req.body.path?.toString() ?? '',
          organizationId,
        ),
        'Dropbox file imported',
      );
    } catch (error) {
      next(error);
    }
  }

  async createDropboxFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.createDropboxFolder(
          req.user!.userId,
          req.body,
          organizationId,
        ),
        'Dropbox folder created',
      );
    } catch (error) {
      next(error);
    }
  }

  async uploadDropboxFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.DROPBOX,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.uploadDropboxFile(
          req.user!.userId,
          req.body,
          organizationId,
        ),
        'Dropbox file uploaded',
      );
    } catch (error) {
      next(error);
    }
  }

  async googleDriveOAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        integrationsService.googleDriveOAuthUrl(req.user!.userId, organizationId),
      );
    } catch (error) {
      next(error);
    }
  }

  async googleDriveCallback(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await integrationsService.handleGoogleDriveCallback({
        code: req.query.code?.toString(),
        state: req.query.state?.toString(),
        error: req.query.error?.toString(),
      });
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .send(callbackPage('Google Drive'));
    } catch (error) {
      next(error);
    }
  }

  async googleDriveStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.googleDriveStatus(req.user!.userId, organizationId),
      );
    } catch (error) {
      next(error);
    }
  }

  async disconnectGoogleDrive(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.disconnectGoogleDrive(
          req.user!.userId,
          organizationId,
        ),
        'Google Drive disconnected',
      );
    } catch (error) {
      next(error);
    }
  }

  async googleDriveFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.listGoogleDriveFiles(
          req.user!.userId,
          req.query.parentId?.toString() ?? 'root',
          req.query.cursor?.toString(),
          organizationId,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async createGoogleDriveFolder(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.createGoogleDriveFolder(
          req.user!.userId,
          req.body,
          organizationId,
        ),
        'Google Drive folder created',
      );
    } catch (error) {
      next(error);
    }
  }

  async uploadGoogleDriveFile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.uploadGoogleDriveFile(
          req.user!.userId,
          req.body,
          organizationId,
        ),
        'Google Drive file uploaded',
      );
    } catch (error) {
      next(error);
    }
  }

  async importGoogleDriveFile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.GOOGLE_DRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.importGoogleDriveFile(
          req.user!.userId,
          req.body.fileId?.toString() ?? '',
          req.body.fileName?.toString(),
          organizationId,
        ),
        'Google Drive file imported',
      );
    } catch (error) {
      next(error);
    }
  }

  async oneDriveOAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        integrationsService.oneDriveOAuthUrl(req.user!.userId, organizationId),
      );
    } catch (error) {
      next(error);
    }
  }

  async oneDriveCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await integrationsService.handleOneDriveCallback({
        code: req.query.code?.toString(),
        state: req.query.state?.toString(),
        error: req.query.error?.toString(),
      });
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .send(callbackPage('OneDrive'));
    } catch (error) {
      next(error);
    }
  }

  async oneDriveStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        queryOrganizationId(req),
      );
      ApiResponse.success(res, await integrationsService.oneDriveStatus(organizationId));
    } catch (error) {
      next(error);
    }
  }

  async disconnectOneDrive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.disconnectOneDrive(organizationId),
        'OneDrive disconnected',
      );
    } catch (error) {
      next(error);
    }
  }

  async oneDriveFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        queryOrganizationId(req),
      );
      ApiResponse.success(
        res,
        await integrationsService.listOneDriveFiles(
          organizationId,
          req.query.parentId?.toString() ?? 'root',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async createOneDriveFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.createOneDriveFolder(organizationId, req.body),
        'OneDrive folder created',
      );
    } catch (error) {
      next(error);
    }
  }

  async uploadOneDriveFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.uploadOneDriveFile(organizationId, req.body),
        'OneDrive file uploaded',
      );
    } catch (error) {
      next(error);
    }
  }

  async importOneDriveFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = await integrationsService.resolveStorageOrganizationId(
        req.user!,
        OrganizationStorageProvider.ONEDRIVE,
        bodyOrganizationId(req),
      );
      ApiResponse.created(
        res,
        await integrationsService.importOneDriveFile(
          organizationId,
          req.body.itemId?.toString() ?? '',
          req.body.fileName?.toString(),
        ),
        'OneDrive file imported',
      );
    } catch (error) {
      next(error);
    }
  }

  async webPortalStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, integrationsService.webPortalStatus(req.user!.userId));
    } catch (error) {
      next(error);
    }
  }

  async webPortalFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await integrationsService.listWebPortalFiles(req.user!.userId),
      );
    } catch (error) {
      next(error);
    }
  }

  async uploadWebPortalFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await integrationsService.uploadWebPortalFile(req.user!.userId, req.body),
        'Web Portal file stored',
      );
    } catch (error) {
      next(error);
    }
  }

  async importWebPortalFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await integrationsService.importWebPortalFile(
          req.user!.userId,
          req.body.path?.toString() ?? '',
          req.body.fileName?.toString(),
        ),
        'Web Portal file imported',
      );
    } catch (error) {
      next(error);
    }
  }

  async lmsStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await integrationsService.lmsStatus(req.user!.userId));
    } catch (error) {
      next(error);
    }
  }

  async createLmsSync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await integrationsService.createLmsSync(req.user!.userId, req.body),
        'LMS sync queued',
      );
    } catch (error) {
      next(error);
    }
  }
}

export const integrationsController = new IntegrationsController();
