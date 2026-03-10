import { Router } from 'express';
import { slidesController } from './slides.controller';
import { authMiddleware } from '@/shared/middleware/auth.middleware';

const router = Router({ mergeParams: true }); // mergeParams to access :id from parent

router.use(authMiddleware);

router.get('/', slidesController.list);
router.post('/', slidesController.create);
router.get('/:sid', slidesController.getById);
router.put('/:sid', slidesController.update);
router.delete('/:sid', slidesController.delete);
router.post('/reorder', slidesController.reorder);

export const slidesRoutes = router;
