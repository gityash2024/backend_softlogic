import { Router } from 'express';
import { exportController } from './export.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { uploadDocumentSingle } from '@/shared/middleware/upload.middleware';

const router = Router();
router.use(authMiddleware);

router.post(
  '/import/convert',
  uploadDocumentSingle('document'),
  exportController.convertImportDocument,
);
router.post('/pdf', exportController.exportPdf);
router.post('/image', exportController.exportImage);
router.get('/:id/status', exportController.getStatus);
router.get('/:id/download', exportController.download);

export const exportRoutes = router;
