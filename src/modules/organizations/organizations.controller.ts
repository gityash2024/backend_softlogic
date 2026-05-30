import { NextFunction, Request, Response } from 'express';

import { licensingService } from '@/modules/licensing/licensing.service';
import { ApiResponse } from '@/shared/utils/api-response';

import { organizationsService } from './organizations.service';

export class OrganizationsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await organizationsService.listAccessibleOrganizations(req.user!);
      ApiResponse.success(res, result, 'Organizations fetched');
    } catch (error) {
      next(error);
    }
  }

  async getLicenseDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await licensingService.getOrganizationLicenseDetails(req.user!, req.params.id);
      ApiResponse.success(res, result);
    } catch (error) {
      next(error);
    }
  }

  async getOwnSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await organizationsService.loadOwnSettings(req.user!);
      ApiResponse.success(res, result);
    } catch (error) {
      next(error);
    }
  }

  async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await organizationsService.loadSettings(req.user!, req.params.id);
      ApiResponse.success(res, result);
    } catch (error) {
      next(error);
    }
  }

  async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = (req.body?.settings ?? {}) as Record<string, unknown>;
      const result = await organizationsService.updateSettings(req.user!, req.params.id, settings);
      ApiResponse.success(res, result, 'Organization settings updated');
    } catch (error) {
      next(error);
    }
  }
}

export const organizationsController = new OrganizationsController();
