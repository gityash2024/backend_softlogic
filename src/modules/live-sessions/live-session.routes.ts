import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { uploadLiveSessionFileSingle } from '@/shared/middleware/upload.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { liveSessionController } from './live-session.controller';
import {
  createLiveSessionSchema,
  createMediaSchema,
  createRecordingSchema,
  controlsSchema,
  generateJoinCodeSchema,
  inviteStudentSchema,
  launchQuizSchema,
  liveSessionEventParamsSchema,
  listLiveSessionsSchema,
  liveSessionIdParamsSchema,
  liveSessionQuizAnswerParamsSchema,
  quizAnswerSchema,
  raiseHandSchema,
  resolveHandSchema,
  sendMessageSchema,
  shareUrlSchema,
  verifyJoinCodeSchema,
} from './live-session.validator';

const router = Router();

const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const joinCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authMiddleware);

router.get('/', validate(listLiveSessionsSchema, 'query'), liveSessionController.list);
router.post('/', validate(createLiveSessionSchema), liveSessionController.create);
router.get(
  '/:id',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.getById,
);
router.post(
  '/:id/start',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.start,
);
router.post(
  '/:id/end',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.end,
);
router.post(
  '/:id/invites',
  inviteLimiter,
  validate(liveSessionIdParamsSchema, 'params'),
  validate(inviteStudentSchema),
  liveSessionController.invite,
);
router.post(
  '/:id/join-code',
  inviteLimiter,
  validate(liveSessionIdParamsSchema, 'params'),
  validate(generateJoinCodeSchema),
  liveSessionController.generateJoinCode,
);
router.get(
  '/:id/join-code',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.getJoinCode,
);
router.post(
  '/join-code/verify',
  joinCodeLimiter,
  validate(verifyJoinCodeSchema),
  liveSessionController.verifyJoinCode,
);
router.post(
  '/join-code/join',
  joinCodeLimiter,
  validate(verifyJoinCodeSchema),
  liveSessionController.joinByCode,
);
router.get(
  '/:id/messages',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.listMessages,
);
router.post(
  '/:id/messages',
  chatLimiter,
  validate(liveSessionIdParamsSchema, 'params'),
  validate(sendMessageSchema),
  liveSessionController.createMessage,
);
router.get(
  '/:id/events',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.listEvents,
);
router.post(
  '/:id/hands',
  validate(liveSessionIdParamsSchema, 'params'),
  validate(raiseHandSchema),
  liveSessionController.raiseHand,
);
router.post(
  '/:id/hands/:eventId/resolve',
  validate(liveSessionEventParamsSchema, 'params'),
  validate(resolveHandSchema),
  liveSessionController.resolveHand,
);
router.post(
  '/:id/controls',
  validate(liveSessionIdParamsSchema, 'params'),
  validate(controlsSchema),
  liveSessionController.updateControls,
);
router.post(
  '/:id/quizzes',
  validate(liveSessionIdParamsSchema, 'params'),
  validate(launchQuizSchema),
  liveSessionController.launchQuiz,
);
router.post(
  '/:id/quizzes/:quizEventId/answers',
  validate(liveSessionQuizAnswerParamsSchema, 'params'),
  validate(quizAnswerSchema),
  liveSessionController.answerQuiz,
);
router.get(
  '/:id/media',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.listMedia,
);
router.post(
  '/:id/media',
  uploadLimiter,
  validate(liveSessionIdParamsSchema, 'params'),
  uploadLiveSessionFileSingle('file'),
  validate(createMediaSchema),
  liveSessionController.createMedia,
);
router.get(
  '/:id/recordings',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.listRecordings,
);
router.post(
  '/:id/recordings',
  uploadLimiter,
  validate(liveSessionIdParamsSchema, 'params'),
  uploadLiveSessionFileSingle('file'),
  validate(createRecordingSchema),
  liveSessionController.createRecording,
);
router.post(
  '/:id/share-url',
  validate(liveSessionIdParamsSchema, 'params'),
  validate(shareUrlSchema),
  liveSessionController.createShareUrl,
);
router.post(
  '/:id/call-token',
  validate(liveSessionIdParamsSchema, 'params'),
  liveSessionController.createCallToken,
);

export const liveSessionRoutes = router;
