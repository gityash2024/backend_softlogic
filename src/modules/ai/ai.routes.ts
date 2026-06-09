import { Router } from 'express';
import { authMiddleware, roleGuard } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { aiController } from './ai.controller';
import {
  aiAllocationSchema,
  aiConfigSchema,
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

export const aiRoutes = router;

export const adminAiRoutes = Router()
  .use(authMiddleware)
  .use(roleGuard('SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'))
  .get('/overview', aiController.adminOverview)
  .put('/config', validate(aiConfigSchema), aiController.adminUpdateConfig)
  .post('/config/test', validate(aiConfigSchema), aiController.adminTestConfig)
  .post('/pools/top-up', validate(aiTopUpSchema), aiController.adminTopUp)
  .post('/allocations', validate(aiAllocationSchema), aiController.adminAllocate);
