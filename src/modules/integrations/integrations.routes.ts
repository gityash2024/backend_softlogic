import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { integrationsController } from './integrations.controller';

const router = Router();
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authMiddleware);

router.get('/google-images', searchLimiter, integrationsController.googleImages);
router.get('/youtube', searchLimiter, integrationsController.youtube);
router.get('/dropbox/oauth-url', integrationsController.dropboxOAuthUrl);
router.get('/dropbox/status', integrationsController.dropboxStatus);
router.post('/dropbox/disconnect', integrationsController.disconnectDropbox);
router.get('/dropbox/files', integrationsController.dropboxFiles);
router.post('/dropbox/import', integrationsController.importDropboxFile);
router.get('/lms/status', integrationsController.lmsStatus);
router.post('/lms/sync', integrationsController.createLmsSync);

export const integrationsRoutes = router;
