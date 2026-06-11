import { Router } from 'express';
import { authMiddleware, roleGuard } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { aiController } from './ai.controller';
import {
  aiAllocationSchema,
  aiConfigSchema,
  aiFeatureAttemptSchema,
  aiGoogleBillingConfigSchema,
  aiPricingSchema,
  aiSetAllocationSchema,
  aiTopUpSchema,
  geminiProxySchema,
} from './ai.validator';

const router = Router();

router.use(authMiddleware);

router.post(
  '/gemini/generate-content',
  validate(geminiProxySchema),
  aiController.proxyGemini,
);
router.post(
  '/feature-attempts/reserve',
  validate(aiFeatureAttemptSchema),
  aiController.reserveFeatureAttempt,
);
router.post(
  '/feature-attempts/commit',
  validate(aiFeatureAttemptSchema),
  aiController.commitFeatureAttempt,
);
router.post(
  '/feature-attempts/fail',
  validate(aiFeatureAttemptSchema),
  aiController.failFeatureAttempt,
);

export const aiRoutes = router;

export const adminAiRoutes = Router()
  .use(authMiddleware)
  .use(roleGuard('SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'))
  .get('/overview', aiController.adminOverview)
  .put('/config', validate(aiConfigSchema), aiController.adminUpdateConfig)
  .post('/config/test', validate(aiConfigSchema), aiController.adminTestConfig)
  .put('/pricing', validate(aiPricingSchema), aiController.adminUpdatePricing)
  .put('/google-billing', validate(aiGoogleBillingConfigSchema), aiController.adminUpdateGoogleBilling)
  .post('/google-billing/sync', aiController.adminSyncGoogleBilling)
  .post('/pools/top-up', validate(aiTopUpSchema), aiController.adminTopUp)
  .post('/allocations', validate(aiAllocationSchema), aiController.adminAllocate)
  .put('/allocations', validate(aiSetAllocationSchema), aiController.adminSetAllocation);
