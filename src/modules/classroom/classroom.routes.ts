import { Router } from 'express';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { classroomController } from './classroom.controller';

const router = Router();

router.use(authMiddleware);
router.get('/me', classroomController.me);
router.get('/content/canvases', classroomController.listContentCanvases);
router.get('/content/activity', classroomController.listContentActivity);
router.get('/content/canvases/:id', classroomController.getContentCanvas);

export const classroomRoutes = router;
