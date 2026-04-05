import { Router } from 'express';
import { settingsController } from './settings.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { updateColorsSchema, updateSettingsSchema } from './settings.validator';

const router = Router();
router.use(authMiddleware);

router.get('/', settingsController.getSettings);
router.put('/', validate(updateSettingsSchema), settingsController.updateSettings);
router.get('/colors', settingsController.getColors);
router.put('/colors', validate(updateColorsSchema), settingsController.updateColors);

export const settingsRoutes = router;
