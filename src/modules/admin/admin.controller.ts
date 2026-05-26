import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { adminService } from './admin.service';
import type { AdminExportFile } from './admin-export.util';

const sendPaginated = <T>(
  res: Response,
  result: {
    items: T[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    filters?: Record<string, unknown>;
  },
) =>
  ApiResponse.success(res, result.items, 'Success', 200, {
    total: result.total,
    page: result.page,
    perPage: result.perPage,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    hasPrevPage: result.hasPrevPage,
    filters: result.filters ?? {},
  });

const sendExport = (res: Response, file: AdminExportFile): void => {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.buffer);
};

export class AdminController {
  async dashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const overview = await adminService.getDashboardOverview(req.user!);
      ApiResponse.success(res, overview);
    } catch (error) {
      next(error);
    }
  }

  async listOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizations = await adminService.listOrganizations(req.user!, req.query as never);
      sendPaginated(res, organizations);
    } catch (error) {
      next(error);
    }
  }

  async getOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await adminService.getOrganization(req.user!, req.params.id);
      ApiResponse.success(res, organization);
    } catch (error) {
      next(error);
    }
  }

  async exportOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportOrganizations(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async createOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await adminService.createOrganization(req.user!, req.body);
      ApiResponse.created(res, organization, 'Organization created');
    } catch (error) {
      next(error);
    }
  }

  async updateOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await adminService.updateOrganization(req.user!, req.params.id, req.body);
      ApiResponse.success(res, organization, 'Organization updated');
    } catch (error) {
      next(error);
    }
  }

  async uploadOrganizationLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await adminService.uploadOrganizationLogo(
        req.user!,
        req.params.id,
        req.file,
      );
      ApiResponse.success(res, organization, 'Organization logo updated');
    } catch (error) {
      next(error);
    }
  }

  async removeOrganizationLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await adminService.removeOrganizationLogo(req.user!, req.params.id);
      ApiResponse.success(res, organization, 'Organization logo removed');
    } catch (error) {
      next(error);
    }
  }

  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await adminService.listUsers(req.user!, req.query as never);
      sendPaginated(res, users);
    } catch (error) {
      next(error);
    }
  }

  async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await adminService.getUser(req.user!, req.params.id);
      ApiResponse.success(res, user);
    } catch (error) {
      next(error);
    }
  }

  async exportUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportUsers(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await adminService.createUser(req.user!, req.body);
      ApiResponse.created(res, user, 'User created');
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await adminService.updateUser(req.user!, req.params.id, req.body);
      ApiResponse.success(res, user, 'User updated');
    } catch (error) {
      next(error);
    }
  }

  async listSubscriptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscriptions = await adminService.listSubscriptions(req.user!, req.query as never);
      sendPaginated(res, subscriptions);
    } catch (error) {
      next(error);
    }
  }

  async getSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.getSubscription(req.user!, req.params.id);
      ApiResponse.success(res, subscription);
    } catch (error) {
      next(error);
    }
  }

  async exportSubscriptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportSubscriptions(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async createSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.createSubscription(req.user!, req.body);
      ApiResponse.created(res, subscription, 'Subscription created');
    } catch (error) {
      next(error);
    }
  }

  async updateSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.updateSubscription(req.user!, req.params.id, req.body);
      ApiResponse.success(res, subscription, 'Subscription updated');
    } catch (error) {
      next(error);
    }
  }

  async listActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const activity = await adminService.listActivity(req.user!, req.query as never);
      sendPaginated(res, activity);
    } catch (error) {
      next(error);
    }
  }

  async exportActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportActivity(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async listContentCanvases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendPaginated(res, await adminService.listContentCanvases(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async getContentCanvas(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await adminService.getContentCanvas(req.user!, req.params.id));
    } catch (error) {
      next(error);
    }
  }

  async exportContentCanvases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportContentCanvases(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async listContentLiveSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendPaginated(res, await adminService.listContentLiveSessions(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async getContentLiveSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await adminService.getContentLiveSession(req.user!, req.params.id));
    } catch (error) {
      next(error);
    }
  }

  async exportContentLiveSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportContentLiveSessions(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async listContentExports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendPaginated(res, await adminService.listContentExports(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async getContentExport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await adminService.getContentExport(req.user!, req.params.id));
    } catch (error) {
      next(error);
    }
  }

  async exportContentExports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportContentExports(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
