import { Router } from 'express';
import { canvasController } from './canvas.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

/** @swagger /canvas - GET - List canvases */
router.get('/', canvasController.list);
/** @swagger /canvas - POST - Create canvas */
router.post('/', canvasController.create);
/** @swagger /canvas/:id - GET - Get canvas */
router.get('/:id', canvasController.getById);
/** @swagger /canvas/:id - PUT - Update canvas */
router.put('/:id', canvasController.update);
/** @swagger /canvas/:id - DELETE - Soft-delete canvas */
router.delete('/:id', canvasController.delete);

export const canvasRoutes = router;
