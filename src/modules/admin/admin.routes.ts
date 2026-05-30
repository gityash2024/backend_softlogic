import { Router } from 'express';
import { authMiddleware, roleGuard } from '@/shared/middleware/auth.middleware';
import { uploadSingle } from '@/shared/middleware/upload.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { adminController } from './admin.controller';
import {
  bulkCreateHardwareActivationKeysSchema,
  bulkInviteSchema,
  createOrganizationSchema,
  createHardwareActivationKeySchema,
  createSubscriptionSchema,
  exportActivationKeysQuerySchema,
  createUserSchema,
  extendAiCreditsSchema,
  exportQuerySchema,
  listActivityQuerySchema,
  listContentCanvasesQuerySchema,
  listContentExportsQuerySchema,
  listContentLiveSessionsQuerySchema,
  listOrganizationsQuerySchema,
  listSubscriptionsQuerySchema,
  listUsersQuerySchema,
  recordOfflinePaymentSchema,
  rejectSubscriptionSchema,
  renewSubscriptionSchema,
  updateOrganizationSchema,
  updatePaymentProviderSchema,
  updateSubscriptionSchema,
  updateUserSchema,
  upsertOrganizationStorageSchema,
} from './admin.validator';

const router = Router();

// #1 Scheduled job endpoint. Registered before the auth/role guards because the
// Vercel cron issues an unauthenticated GET and authorizes via the CRON_SECRET
// bearer token checked inside the controller.
router.get('/jobs/subscription-sweep', adminController.subscriptionSweep);

router.use(authMiddleware);
router.use(roleGuard('SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'));

router.get('/dashboard', adminController.dashboard);

router.get('/organizations', validate(listOrganizationsQuerySchema, 'query'), adminController.listOrganizations);
router.get('/organizations/export', validate(listOrganizationsQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportOrganizations);
router.get('/organizations/:id', adminController.getOrganization);
router.post('/organizations', validate(createOrganizationSchema), adminController.createOrganization);
router.put('/organizations/:id', validate(updateOrganizationSchema), adminController.updateOrganization);
router.patch('/organizations/:id', validate(updateOrganizationSchema), adminController.updateOrganization);
router.delete('/organizations/:id', adminController.deleteOrganization);
router.post('/organizations/:id/logo', uploadSingle('logo'), adminController.uploadOrganizationLogo);
router.delete('/organizations/:id/logo', adminController.removeOrganizationLogo);
router.put('/organizations/:id/storage', validate(upsertOrganizationStorageSchema), adminController.upsertOrganizationStorage);

router.get('/users', validate(listUsersQuerySchema, 'query'), adminController.listUsers);
router.get('/users/export', validate(listUsersQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportUsers);
router.get('/users/:id', adminController.getUser);
router.post('/users', validate(createUserSchema), adminController.createUser);
router.post('/users/bulk-invite', validate(bulkInviteSchema), adminController.bulkInviteUsers);
router.put('/users/:id', validate(updateUserSchema), adminController.updateUser);
router.patch('/users/:id', validate(updateUserSchema), adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.post('/users/:id/resend-invite', adminController.resendUserInvite);
router.post('/users/:id/force-logout', adminController.forceLogoutUser);
router.post('/users/:id/impersonate', adminController.impersonateUser);

router.get('/subscriptions', validate(listSubscriptionsQuerySchema, 'query'), adminController.listSubscriptions);
router.get('/subscriptions/export', validate(listSubscriptionsQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportSubscriptions);
router.get('/subscriptions/:id', adminController.getSubscription);
router.get('/subscriptions/:id/details', adminController.getSubscriptionDetails);
router.get('/subscriptions/:id/payments', adminController.listSubscriptionPayments);
router.post('/subscriptions', validate(createSubscriptionSchema), adminController.createSubscription);
router.put('/subscriptions/:id', validate(updateSubscriptionSchema), adminController.updateSubscription);
router.patch('/subscriptions/:id', validate(updateSubscriptionSchema), adminController.updateSubscription);
router.post('/subscriptions/:id/renew', validate(renewSubscriptionSchema), adminController.renewSubscription);
router.post('/subscriptions/:id/approve', adminController.approveSubscription);
router.post('/subscriptions/:id/reject', validate(rejectSubscriptionSchema), adminController.rejectSubscription);

router.get('/payment/providers', adminController.listPaymentProviders);
router.put('/payment/providers', validate(updatePaymentProviderSchema), adminController.updatePaymentProvider);
router.post('/payments/offline', validate(recordOfflinePaymentSchema), adminController.recordOfflinePayment);

// Static activation-key paths (/export, /bulk) are registered before any param-style
// `/hardware/activation-keys/:id` route so they are not shadowed by a path param.
router.get('/hardware/activation-keys/export', validate(exportActivationKeysQuerySchema, 'query'), adminController.exportHardwareActivationKeys);
router.post('/hardware/activation-keys/bulk', validate(bulkCreateHardwareActivationKeysSchema), adminController.bulkCreateHardwareActivationKeys);
router.post('/hardware/activation-keys', validate(createHardwareActivationKeySchema), adminController.createHardwareActivationKey);
router.post('/hardware/activation-keys/email-org-admin', adminController.emailActivationKeysToOrgAdmin);
router.post('/hardware/activations/:id/reset', adminController.resetHardwareActivation);
router.get('/organizations/:id/license-details', adminController.getOrganizationLicenseDetails);

router.post('/ai-credits/extensions', validate(extendAiCreditsSchema), adminController.extendAiCredits);
router.post('/organizations/:id/license-usage/recalculate', adminController.recalculateLicenseUsage);

router.get('/activity', validate(listActivityQuerySchema, 'query'), adminController.listActivity);
router.get('/activity/export', validate(listActivityQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportActivity);

router.get('/content/canvases', validate(listContentCanvasesQuerySchema, 'query'), adminController.listContentCanvases);
router.get('/content/canvases/export', validate(listContentCanvasesQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportContentCanvases);
router.get('/content/canvases/:id', adminController.getContentCanvas);
router.get('/content/live-sessions', validate(listContentLiveSessionsQuerySchema, 'query'), adminController.listContentLiveSessions);
router.get('/content/live-sessions/export', validate(listContentLiveSessionsQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportContentLiveSessions);
router.get('/content/live-sessions/:id', adminController.getContentLiveSession);
router.get('/content/exports', validate(listContentExportsQuerySchema, 'query'), adminController.listContentExports);
router.get('/content/exports/export', validate(listContentExportsQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportContentExports);
router.get('/content/exports/:id', adminController.getContentExport);

export const adminRoutes = router;
