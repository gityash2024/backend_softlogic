import { Router } from 'express';
import { z } from 'zod';

import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';

import { organizationsController } from './organizations.controller';

const router = Router();

const updateSettingsSchema = z.object({
  settings: z.record(z.unknown()),
});

router.use(authMiddleware);

router.get('/', organizationsController.list);
router.get('/settings', organizationsController.getOwnSettings);
router.get('/:id/license-details', organizationsController.getLicenseDetails);
router.get('/:id/settings', organizationsController.getSettings);
router.put('/:id/settings', validate(updateSettingsSchema), organizationsController.updateSettings);

export const organizationsRoutes = router;
