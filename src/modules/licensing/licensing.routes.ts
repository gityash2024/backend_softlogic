import { Router } from 'express';
import { z } from 'zod';

import { authMiddleware } from '@/shared/middleware/auth.middleware';
import { validate } from '@/shared/middleware/validation.middleware';
import { ApiResponse } from '@/shared/utils/api-response';
import { licensingService } from './licensing.service';

const router = Router();

const deviceMetaSchema = z
  .object({
    platform: z.string().trim().max(40).optional().nullable(),
    manufacturer: z.string().trim().max(120).optional().nullable(),
    model: z.string().trim().max(160).optional().nullable(),
    osVersion: z.string().trim().max(120).optional().nullable(),
    appVersion: z.string().trim().max(60).optional().nullable(),
  })
  .partial()
  .passthrough()
  .optional()
  .nullable();

const hardwareActivationSchema = z.object({
  activationKey: z.string().trim().min(8),
  deviceFingerprint: z.string().trim().min(8),
  deviceLabel: z.string().trim().max(120).optional().nullable(),
  deviceMeta: deviceMetaSchema,
});

const hardwareVerifySchema = z.object({
  activationKey: z.string().trim().min(8),
  deviceFingerprint: z.string().trim().min(8),
  deviceMeta: deviceMetaSchema,
});

// Public — Flutter calls this on every cold launch to confirm the device is still bound.
router.post('/hardware/verify', validate(hardwareVerifySchema), async (req, res, next) => {
  try {
    const result = await licensingService.verifyHardwareActivation({
      activationKey: req.body.activationKey,
      deviceFingerprint: req.body.deviceFingerprint,
      deviceMeta: req.body.deviceMeta ?? null,
      userId: req.user?.userId ?? null,
    });
    ApiResponse.success(res, result, result.valid ? 'Hardware activation verified' : 'Hardware activation invalid');
  } catch (error) {
    next(error);
  }
});

router.use(authMiddleware);

router.post('/hardware/activate', validate(hardwareActivationSchema), async (req, res, next) => {
  try {
    const activation = await licensingService.bindHardwareActivation({
      activationKey: req.body.activationKey,
      deviceFingerprint: req.body.deviceFingerprint,
      deviceLabel: req.body.deviceLabel,
      deviceMeta: req.body.deviceMeta ?? null,
      userId: req.user?.userId,
    });
    ApiResponse.success(res, activation, 'Hardware activation bound');
  } catch (error) {
    next(error);
  }
});

export const licensingRoutes = router;
