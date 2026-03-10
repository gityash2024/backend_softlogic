import { Router } from 'express';
import { settingsController } from './settings.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);
router.get('/colors', settingsController.getColors);
router.put('/colors', settingsController.updateColors);

export const settingsRoutes = router;
