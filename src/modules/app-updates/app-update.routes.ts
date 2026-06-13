import { Router } from 'express';
import { validate } from '@/shared/middleware/validation.middleware';
import { appUpdateController } from './app-update.controller';
import { checkAppUpdateQuerySchema } from './app-update.validator';

const router = Router();

router.get(
  '/check',
  validate(checkAppUpdateQuerySchema, 'query'),
  appUpdateController.check,
);

export const appUpdateRoutes = router;
