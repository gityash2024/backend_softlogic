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
router.post('/dropbox/folders', integrationsController.createDropboxFolder);
router.post('/dropbox/upload', integrationsController.uploadDropboxFile);
router.post('/dropbox/import', integrationsController.importDropboxFile);
router.get('/google-drive/oauth-url', integrationsController.googleDriveOAuthUrl);
router.get('/google-drive/status', integrationsController.googleDriveStatus);
router.post('/google-drive/disconnect', integrationsController.disconnectGoogleDrive);
router.get('/google-drive/files', integrationsController.googleDriveFiles);
router.post('/google-drive/folders', integrationsController.createGoogleDriveFolder);
router.post('/google-drive/upload', integrationsController.uploadGoogleDriveFile);
router.post('/google-drive/import', integrationsController.importGoogleDriveFile);
router.get('/onedrive/oauth-url', integrationsController.oneDriveOAuthUrl);
router.get('/onedrive/status', integrationsController.oneDriveStatus);
router.post('/onedrive/disconnect', integrationsController.disconnectOneDrive);
router.get('/onedrive/files', integrationsController.oneDriveFiles);
router.post('/onedrive/folders', integrationsController.createOneDriveFolder);
router.post('/onedrive/upload', integrationsController.uploadOneDriveFile);
router.post('/onedrive/import', integrationsController.importOneDriveFile);
router.get('/web-portal/status', integrationsController.webPortalStatus);
router.get('/web-portal/files', integrationsController.webPortalFiles);
router.post('/web-portal/upload', integrationsController.uploadWebPortalFile);
router.post('/web-portal/import', integrationsController.importWebPortalFile);
router.get('/lms/status', integrationsController.lmsStatus);
router.post('/lms/sync', integrationsController.createLmsSync);

export const integrationsRoutes = router;
