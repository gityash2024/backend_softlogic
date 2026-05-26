import { Router } from 'express';

import { validate } from '@/shared/middleware/validation.middleware';

import { feedbackController } from './feedback.controller';
import {
  addCommentSchema,
  createThreadSchema,
  deleteAuthSchema,
  editCommentSchema,
  listThreadsQuerySchema,
  updateThreadStatusSchema,
} from './feedback.validator';

const router = Router();

router.get(
  '/threads',
  validate(listThreadsQuerySchema, 'query'),
  feedbackController.listThreads,
);
router.post(
  '/threads',
  validate(createThreadSchema),
  feedbackController.createThread,
);
router.patch(
  '/threads/:id',
  validate(updateThreadStatusSchema),
  feedbackController.updateThreadStatus,
);
router.post(
  '/threads/:id/comments',
  validate(addCommentSchema),
  feedbackController.addComment,
);
router.patch(
  '/comments/:id',
  validate(editCommentSchema),
  feedbackController.editComment,
);
router.delete(
  '/comments/:id',
  validate(deleteAuthSchema, 'query'),
  feedbackController.deleteComment,
);

export const feedbackRoutes = router;
