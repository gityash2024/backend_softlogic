import { Router } from 'express';

import { authMiddleware, roleGuard } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';

import { supportController } from './support.controller';
import {
  addMessageSchema,
  applyActionSchema,
  createThreadSchema,
  listThreadsQuerySchema,
  setPrioritySchema,
  updateStatusSchema,
} from './support.validator';

const router = Router();

router.use(authMiddleware);
router.use(roleGuard('SUPER_ADMIN', 'PARTNER_ADMIN', 'CUSTOMER_ADMIN', 'ADMIN'));

router.get('/threads/unread-count', supportController.getUnreadCount);
router.get('/threads', validate(listThreadsQuerySchema, 'query'), supportController.listThreads);
router.post('/threads', validate(createThreadSchema), supportController.createThread);
router.get('/threads/:id', supportController.getThread);
router.post('/threads/:id/messages', validate(addMessageSchema), supportController.addMessage);
router.patch('/threads/:id/status', validate(updateStatusSchema), supportController.updateStatus);
router.patch('/threads/:id/priority', validate(setPrioritySchema), supportController.setPriority);
router.post('/threads/:id/actions', validate(applyActionSchema), supportController.applyAction);

export const supportRoutes = router;
