import { Router } from 'express';

import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';

import { i18nController } from './i18n.controller';
import { translatePortalTextsSchema } from './i18n.validator';

const router = Router();

router.use(authMiddleware);
router.get('/languages', i18nController.getLanguages);
router.post('/translate', validate(translatePortalTextsSchema), i18nController.translate);

export const i18nRoutes = router;
