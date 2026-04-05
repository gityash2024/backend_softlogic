import { Router } from 'express';
import { authMiddleware, roleGuard } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { adminController } from './admin.controller';
import {
  createOrganizationSchema,
  createSubscriptionSchema,
  createUserSchema,
  updateSubscriptionSchema,
  updateUserSchema,
} from './admin.validator';

const router = Router();

router.use(authMiddleware);
router.use(roleGuard('SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'));

router.get('/organizations', adminController.listOrganizations);
router.post('/organizations', validate(createOrganizationSchema), adminController.createOrganization);

router.get('/users', adminController.listUsers);
router.post('/users', validate(createUserSchema), adminController.createUser);
router.put('/users/:id', validate(updateUserSchema), adminController.updateUser);
router.patch('/users/:id', validate(updateUserSchema), adminController.updateUser);

router.get('/subscriptions', adminController.listSubscriptions);
router.post('/subscriptions', validate(createSubscriptionSchema), adminController.createSubscription);
router.put('/subscriptions/:id', validate(updateSubscriptionSchema), adminController.updateSubscription);
router.patch('/subscriptions/:id', validate(updateSubscriptionSchema), adminController.updateSubscription);

router.get('/activity', adminController.listActivity);

export const adminRoutes = router;
