import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { uploadLiveSessionFileSingle } from '@/shared/middleware/upload.middleware';
import { mediaController } from './media.controller';

const router = Router();
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authMiddleware);

router.post('/upload', uploadLimiter, uploadLiveSessionFileSingle('file'), mediaController.upload);

export const mediaRoutes = router;
