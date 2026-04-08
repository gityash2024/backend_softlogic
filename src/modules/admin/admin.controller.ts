import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { adminService } from './admin.service';

export class AdminController {
  async listOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizations = await adminService.listOrganizations(req.user!);
      ApiResponse.success(res, organizations);
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
      const users = await adminService.listUsers(req.user!);
      ApiResponse.success(res, users);
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
      const subscriptions = await adminService.listSubscriptions(req.user!);
      ApiResponse.success(res, subscriptions);
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
      const activity = await adminService.listActivity(req.user!);
      ApiResponse.success(res, activity);
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
