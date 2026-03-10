import { Router } from 'express';
import { exportController } from './export.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.post('/pdf', exportController.exportPdf);
router.post('/image', exportController.exportImage);
router.get('/:id/status', exportController.getStatus);
router.get('/:id/download', exportController.download);

export const exportRoutes = router;
