import { Router } from 'express';
import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { classroomController } from './classroom.controller';

const router = Router();

router.use(authMiddleware);
router.get('/me', classroomController.me);

export const classroomRoutes = router;
