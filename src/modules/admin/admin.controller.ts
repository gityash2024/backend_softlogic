import { NextFunction, Request, Response } from 'express';
import { env } from '@/config';
import { ApiResponse } from '@/shared/utils/api-response';
import { licensingService } from '@/modules/licensing/licensing.service';
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

  async deleteOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.deleteOrganization(req.user!, req.params.id);
      ApiResponse.success(res, result, 'Organization archived');
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

  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.deleteUser(req.user!, req.params.id);
      ApiResponse.success(res, result, 'User deleted');
    } catch (error) {
      next(error);
    }
  }

  async resendUserInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.resendUserInvite(req.user!, req.params.id);
      ApiResponse.success(res, result, 'Invite resent');
    } catch (error) {
      next(error);
    }
  }

  async forceLogoutUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.forceLogoutUser(req.user!, req.params.id);
      ApiResponse.success(res, result, 'User signed out of all devices');
    } catch (error) {
      next(error);
    }
  }

  async bulkInviteUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.bulkInviteUsers(req.user!, req.body);
      ApiResponse.success(res, result, 'Bulk invite processed');
    } catch (error) {
      next(error);
    }
  }

  async impersonateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.impersonateUser(req.user!, req.params.id);
      ApiResponse.success(res, result, 'Impersonation token issued');
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

  async deleteSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.deleteSubscription(req.user!, req.params.id);
      ApiResponse.success(res, subscription, 'Subscription archived');
    } catch (error) {
      next(error);
    }
  }

  async restoreSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.restoreSubscription(req.user!, req.params.id);
      ApiResponse.success(res, subscription, 'Subscription restored');
    } catch (error) {
      next(error);
    }
  }

  async renewSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.renewSubscription(req.user!, req.params.id, req.body);
      ApiResponse.success(res, subscription, 'Subscription renewed');
    } catch (error) {
      next(error);
    }
  }

  async approveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.approveSubscription(req.user!, req.params.id);
      ApiResponse.success(res, subscription, 'Subscription approved');
    } catch (error) {
      next(error);
    }
  }

  async rejectSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await adminService.rejectSubscription(
        req.user!,
        req.params.id,
        req.body?.reason ?? null,
      );
      ApiResponse.success(res, subscription, 'Subscription rejected');
    } catch (error) {
      next(error);
    }
  }

  // #1 Scheduled subscription sweep. Invoked by Vercel cron via GET with an
  // `Authorization: Bearer <CRON_SECRET>` header instead of a user JWT, so this
  // handler is mounted before the auth/role guards and authorizes itself.
  async subscriptionSweep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const header = req.headers.authorization ?? '';
      if (header !== `Bearer ${env.CRON_SECRET}`) {
        ApiResponse.error(res, 'Unauthorized', 401);
        return;
      }
      const summary = await licensingService.sweepSubscriptions();
      ApiResponse.success(res, summary, 'Subscription sweep completed');
    } catch (error) {
      next(error);
    }
  }

  async listPaymentProviders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await adminService.listPaymentProviders(req.user!));
    } catch (error) {
      next(error);
    }
  }

  async updatePaymentProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.updatePaymentProvider(req.user!, req.body),
        'Payment provider updated',
      );
    } catch (error) {
      next(error);
    }
  }

  async recordOfflinePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await adminService.recordOfflinePayment(req.user!, req.body),
        'Offline payment recorded',
      );
    } catch (error) {
      next(error);
    }
  }

  async createHardwareActivationKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await adminService.createHardwareActivationKey(req.user!, req.body),
        'Hardware activation key created',
      );
    } catch (error) {
      next(error);
    }
  }

  async bulkCreateHardwareActivationKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await adminService.bulkCreateHardwareActivationKeys(req.user!, req.body),
        'Hardware activation keys created',
      );
    } catch (error) {
      next(error);
    }
  }

  async exportHardwareActivationKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportHardwareActivationKeys(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async listSubscriptionPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.listSubscriptionPayments(req.user!, req.params.id),
      );
    } catch (error) {
      next(error);
    }
  }

  async resetHardwareActivation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.resetHardwareActivation(req.user!, req.params.id),
        'Hardware activation reset',
      );
    } catch (error) {
      next(error);
    }
  }

  async revokeHardwareActivationKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.revokeHardwareActivationKey(req.user!, req.params.id),
        'Hardware activation key revoked',
      );
    } catch (error) {
      next(error);
    }
  }

  async replaceHardwareActivationKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await adminService.replaceHardwareActivationKey(req.user!, req.params.id),
        'Hardware activation key replaced',
      );
    } catch (error) {
      next(error);
    }
  }

  async getSubscriptionDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.getSubscriptionDetails(req.user!, req.params.id),
      );
    } catch (error) {
      next(error);
    }
  }

  async getOrganizationLicenseDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.getOrganizationLicenseDetails(req.user!, req.params.id),
      );
    } catch (error) {
      next(error);
    }
  }

  async emailActivationKeysToOrgAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = String(req.body?.organizationId ?? '');
      if (!organizationId) {
        ApiResponse.error(res, 'organizationId is required', 400);
        return;
      }
      ApiResponse.success(
        res,
        await adminService.emailActivationKeysToOrgAdmin(req.user!, organizationId),
        'Activation keys emailed to organization admin',
      );
    } catch (error) {
      next(error);
    }
  }

  async extendAiCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await adminService.extendAiCredits(req.user!, req.body),
        'AI credits extended',
      );
    } catch (error) {
      next(error);
    }
  }

  async recalculateLicenseUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.recalculateOrganizationLicenseUsage(req.user!, req.params.id),
        'License usage recalculated',
      );
    } catch (error) {
      next(error);
    }
  }

  async upsertOrganizationStorage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await adminService.upsertOrganizationStorageConnection(
          req.user!,
          req.params.id,
          req.body,
        ),
        'Organization storage updated',
      );
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

  async listContentImports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendPaginated(res, await adminService.listContentImports(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }

  async getContentImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await adminService.getContentImport(req.user!, req.params.id));
    } catch (error) {
      next(error);
    }
  }

  async exportContentImports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendExport(res, await adminService.exportContentImports(req.user!, req.query as never));
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
