import { Router } from 'express';
import { authMiddleware, roleGuard } from '@/shared/middleware/auth.middleware';
import { uploadSingle } from '@/shared/middleware/upload.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { adminController } from './admin.controller';
import {
  createOrganizationSchema,
  createSubscriptionSchema,
  createUserSchema,
  exportQuerySchema,
  listActivityQuerySchema,
  listContentCanvasesQuerySchema,
  listContentExportsQuerySchema,
  listContentLiveSessionsQuerySchema,
  listOrganizationsQuerySchema,
  listSubscriptionsQuerySchema,
  listUsersQuerySchema,
  updateOrganizationSchema,
  updateSubscriptionSchema,
  updateUserSchema,
} from './admin.validator';

const router = Router();

router.use(authMiddleware);
router.use(roleGuard('SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'));

router.get('/dashboard', adminController.dashboard);

router.get('/organizations', validate(listOrganizationsQuerySchema, 'query'), adminController.listOrganizations);
router.get('/organizations/export', validate(listOrganizationsQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportOrganizations);
router.get('/organizations/:id', adminController.getOrganization);
router.post('/organizations', validate(createOrganizationSchema), adminController.createOrganization);
router.put('/organizations/:id', validate(updateOrganizationSchema), adminController.updateOrganization);
router.patch('/organizations/:id', validate(updateOrganizationSchema), adminController.updateOrganization);
router.post('/organizations/:id/logo', uploadSingle('logo'), adminController.uploadOrganizationLogo);
router.delete('/organizations/:id/logo', adminController.removeOrganizationLogo);

router.get('/users', validate(listUsersQuerySchema, 'query'), adminController.listUsers);
router.get('/users/export', validate(listUsersQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportUsers);
router.get('/users/:id', adminController.getUser);
router.post('/users', validate(createUserSchema), adminController.createUser);
router.put('/users/:id', validate(updateUserSchema), adminController.updateUser);
router.patch('/users/:id', validate(updateUserSchema), adminController.updateUser);

router.get('/subscriptions', validate(listSubscriptionsQuerySchema, 'query'), adminController.listSubscriptions);
router.get('/subscriptions/export', validate(listSubscriptionsQuerySchema.merge(exportQuerySchema), 'query'), adminController.exportSubscriptions);
router.get('/subscriptions/:id', adminController.getSubscription);
router.post('/subscriptions', validate(createSubscriptionSchema), adminController.createSubscription);
router.put('/subscriptions/:id', validate(updateSubscriptionSchema), adminController.updateSubscription);
router.patch('/subscriptions/:id', validate(updateSubscriptionSchema), adminController.updateSubscription);

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
