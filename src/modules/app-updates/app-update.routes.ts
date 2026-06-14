import { Router } from 'express';
import { validate } from '@/shared/middleware/validation.middleware';
import { appUpdateController } from './app-update.controller';
import {
  checkAppUpdateQuerySchema,
  currentAppDownloadsQuerySchema,
} from './app-update.validator';

const router = Router();

router.get(
  '/check',
  validate(checkAppUpdateQuerySchema, 'query'),
  appUpdateController.check,
);

router.get(
  '/current',
  validate(currentAppDownloadsQuerySchema, 'query'),
  appUpdateController.current,
);

export const appUpdateRoutes = router;
