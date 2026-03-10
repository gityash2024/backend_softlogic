import { Router } from 'express';
import { filterController } from './filter.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.post('/check', filterController.check);

export const filterRoutes = router;
