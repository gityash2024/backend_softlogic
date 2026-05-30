import {
  LiveSessionMediaKind,
  LiveSessionMessageType,
  LiveSessionRecordingStatus,
  LiveSessionStatus,
} from '@prisma/client';
import { z } from 'zod';

export const createLiveSessionSchema = z.object({
  canvasId: z.string().uuid(),
  title: z.string().min(2).max(160).optional(),
  studentPermissions: z
    .object({
      chat: z.boolean().default(true),
      audio: z.boolean().default(true),
      video: z.boolean().default(true),
      boardView: z.boolean().default(true),
      boardActivity: z.boolean().default(true),
      boardEdit: z.boolean().default(false),
    })
    .partial()
    .optional(),
});

export const liveSessionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const liveSessionEventParamsSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
});

export const liveSessionQuizAnswerParamsSchema = z.object({
  id: z.string().uuid(),
  quizEventId: z.string().uuid(),
});

export const listLiveSessionsSchema = z.object({
  status: z.nativeEnum(LiveSessionStatus).optional(),
});

export const generateJoinCodeSchema = z.object({
  expiresInMinutes: z.coerce.number().int().min(5).max(10080).default(240),
  forceRefresh: z.boolean().default(false),
});

export const inviteStudentSchema = z.object({
  email: z.string().email(),
  downloadPageUrl: z.string().url().optional(),
  expiresInMinutes: z.coerce.number().int().min(5).max(10080).default(1440),
});

export const verifyJoinCodeSchema = z.object({
  code: z.string().trim().min(4).max(16),
});

export const sessionOnlyJoinSchema = verifyJoinCodeSchema.extend({
  displayName: z.string().trim().min(1).max(120).optional(),
});

export const sendMessageSchema = z.object({
  type: z.nativeEnum(LiveSessionMessageType).default(LiveSessionMessageType.TEXT),
  body: z.string().max(5000).optional(),
  attachmentUrl: z.string().url().optional(),
  attachmentName: z.string().max(180).optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine((value) => Boolean(value.body?.trim() || value.attachmentUrl), {
  message: 'Message body or attachment is required',
});

export const createMediaSchema = z.object({
  kind: z.nativeEnum(LiveSessionMediaKind).default(LiveSessionMediaKind.FILE),
  publicUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createRecordingSchema = z.object({
  status: z
    .nativeEnum(LiveSessionRecordingStatus)
    .default(LiveSessionRecordingStatus.PROCESSING),
  publicUrl: z.string().url().optional(),
  storageKey: z.string().max(500).optional(),
  durationSeconds: z.coerce.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const shareUrlSchema = z.object({
  recordingId: z.string().uuid().optional(),
  emailTo: z.string().email().optional(),
});

export const raiseHandSchema = z.object({
  reason: z.string().trim().max(240).optional(),
});

export const resolveHandSchema = z.object({
  resolution: z.enum(['ALLOWED', 'DISMISSED']).default('ALLOWED'),
});

export const controlsSchema = z.object({
  muted: z.boolean().optional(),
  boardLocked: z.boolean().optional(),
  spotlightMode: z.boolean().optional(),
  timerRunning: z.boolean().optional(),
  boardMode: z.string().trim().max(80).optional(),
});

export const launchQuizSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(240)).min(2).max(8),
  correctIndex: z.coerce.number().int().min(0).optional(),
  durationSeconds: z.coerce.number().int().min(10).max(7200).optional(),
});

export const quizAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(500),
});
