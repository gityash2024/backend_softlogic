import { LiveSessionStatus, Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/config';
import {
  AuthenticatedUserLike,
  getAccessibleOrganizationIds,
  isSuperAdmin,
} from '@/shared/utils/access-control';
import { liveSessionService } from '@/modules/live-sessions/live-session.service';

type ClassroomUser = AuthenticatedUserLike & { email?: string };
type ClassroomEvent = Prisma.LiveSessionEventGetPayload<{
  include: {
    actor: { select: { id: true; email: true; name: true; role: true } };
  };
}>;
type ClassroomMediaAsset = Prisma.LiveSessionMediaAssetGetPayload<object>;
type ClassroomRecording = Prisma.LiveSessionRecordingGetPayload<object>;

const asRecord = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const dateLabel = (value: Date): string => value.toISOString();

export class ClassroomService {
  async getMe(user: ClassroomUser) {
    const [profile, sessions, canvases] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          timezone: true,
          language: true,
          primaryOrganizationId: true,
        },
      }),
      liveSessionService.listSessions(user),
      this.listCanvases(user),
    ]);

    const sessionIds = sessions.map((session) => session.id);
    let events: ClassroomEvent[] = [];
    let mediaAssets: ClassroomMediaAsset[] = [];
    let recordings: ClassroomRecording[] = [];
    if (sessionIds.length > 0) {
      [events, mediaAssets, recordings] = await Promise.all([
        prisma.liveSessionEvent.findMany({
          where: { liveSessionId: { in: sessionIds } },
          include: {
            actor: { select: { id: true, email: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 1000,
        }),
        prisma.liveSessionMediaAsset.findMany({
          where: { liveSessionId: { in: sessionIds } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.liveSessionRecording.findMany({
          where: { liveSessionId: { in: sessionIds } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);
    }

    const activeSession =
      sessions.find((session) => session.status === LiveSessionStatus.LIVE) ??
      sessions.find((session) => session.status === LiveSessionStatus.SCHEDULED) ??
      null;

    return {
      profile: profile
        ? {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            role: profile.role,
            timezone: profile.timezone,
            language: profile.language,
            primaryOrganizationId: profile.primaryOrganizationId,
          }
        : {
            id: user.userId,
            email: user.email ?? '',
            name: null,
            role: user.role,
          },
      role: user.role,
      activeSessionId: activeSession?.id ?? null,
      sessions,
      canvases: canvases.map((canvas) => ({
        id: canvas.id,
        title: canvas.name,
        description: canvas.description,
        updatedAt: canvas.updatedAt,
        slideCount: canvas._count.slides,
      })),
      materials: this.materialsFrom(canvases, mediaAssets, recordings),
      schedule: sessions
        .filter(
          (session) =>
            session.status === LiveSessionStatus.SCHEDULED ||
            session.status === LiveSessionStatus.LIVE,
        )
        .map((session) => ({
          id: session.id,
          title: session.title ?? session.canvas?.name ?? 'Live Session',
          status: session.status,
          canvasId: session.canvasId,
          startsAt: session.startedAt,
          participantCount: session.participants.length,
        })),
      notifications: this.notificationsFrom(events),
      participants: activeSession?.participants ?? [],
      raisedHands: this.raisedHandsFrom(events),
      controls: this.latestPayload(events, 'CONTROLS_UPDATED'),
      quizzes: this.quizzesFrom(events),
      events,
    };
  }

  private async listCanvases(user: ClassroomUser) {
    const organizationIds = await getAccessibleOrganizationIds(user);
    const where: Prisma.CanvasWhereInput = isSuperAdmin(user.role)
      ? { deletedAt: null }
      : {
          deletedAt: null,
          OR: [
            { userId: user.userId },
            ...(organizationIds && organizationIds.length > 0
              ? [{ organizationId: { in: organizationIds } }]
              : []),
          ],
        };

    if (user.role === UserRole.STUDENT) {
      const sessionCanvasIds = (
        await liveSessionService.listSessions(user)
      ).map((session) => session.canvasId);
      if (sessionCanvasIds.length > 0) {
        where.OR = [
          ...(Array.isArray(where.OR) ? where.OR : []),
          { id: { in: sessionCanvasIds } },
        ];
      }
    }

    return prisma.canvas.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { slides: true } } },
      take: 100,
    });
  }

  private materialsFrom(
    canvases: Awaited<ReturnType<ClassroomService['listCanvases']>>,
    mediaAssets: Array<{
      id: string;
      liveSessionId: string;
      kind: string;
      fileName: string;
      publicUrl: string | null;
      createdAt: Date;
    }>,
    recordings: Array<{
      id: string;
      liveSessionId: string;
      status: string;
      publicUrl: string | null;
      createdAt: Date;
    }>,
  ) {
    return [
      ...canvases.map((canvas) => ({
        id: canvas.id,
        title: canvas.name,
        subtitle: `Board updated ${dateLabel(canvas.updatedAt)}`,
        kind: 'Boards',
        source: 'canvas',
        canvasId: canvas.id,
        createdAt: canvas.updatedAt,
      })),
      ...mediaAssets.map((asset) => ({
        id: asset.id,
        title: asset.fileName,
        subtitle: `Uploaded ${dateLabel(asset.createdAt)}`,
        kind: this.materialKind(asset.kind),
        source: 'liveSessionMedia',
        liveSessionId: asset.liveSessionId,
        publicUrl: asset.publicUrl,
        createdAt: asset.createdAt,
      })),
      ...recordings.map((recording) => ({
        id: recording.id,
        title: `Recording ${dateLabel(recording.createdAt)}`,
        subtitle: recording.status,
        kind: 'Recordings',
        source: 'liveSessionRecording',
        liveSessionId: recording.liveSessionId,
        publicUrl: recording.publicUrl,
        createdAt: recording.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private materialKind(kind: string) {
    if (kind === 'VIDEO' || kind === 'IMAGE' || kind === 'IMPORT') {
      return 'Files';
    }
    if (kind === 'VOICE_NOTE') {
      return 'Recordings';
    }
    return 'Files';
  }

  private notificationsFrom(
    events: Array<{
      id: string;
      liveSessionId: string;
      type: string;
      payload: Prisma.JsonValue | null;
      createdAt: Date;
      actor?: { name: string | null; email: string; role: UserRole } | null;
    }>,
  ) {
    return events
      .filter((event) =>
        [
          'SESSION_STARTED',
          'SESSION_ENDED',
          'HAND_RAISED',
          'QUIZ_LAUNCHED',
          'RECORDING_READY',
          'MEDIA_UPLOADED',
        ].includes(event.type),
      )
      .slice(-20)
      .reverse()
      .map((event) => ({
        id: event.id,
        liveSessionId: event.liveSessionId,
        type: event.type,
        title: event.type.replaceAll('_', ' ').toLowerCase(),
        actorName: event.actor?.name || event.actor?.email || null,
        createdAt: event.createdAt,
        payload: asRecord(event.payload),
      }));
  }

  private raisedHandsFrom(
    events: Array<{
      id: string;
      liveSessionId: string;
      type: string;
      payload: Prisma.JsonValue | null;
      createdAt: Date;
      actorUserId: string | null;
      actor?: { id: string; name: string | null; email: string; role: UserRole } | null;
    }>,
  ) {
    const resolved = new Set(
      events
        .filter((event) => event.type === 'HAND_RESOLVED')
        .map((event) => asRecord(event.payload).handEventId?.toString())
        .filter(Boolean),
    );
    return events
      .filter((event) => event.type === 'HAND_RAISED' && !resolved.has(event.id))
      .map((event) => ({
        id: event.id,
        liveSessionId: event.liveSessionId,
        userId: event.actorUserId,
        name: event.actor?.name || event.actor?.email || 'Student',
        email: event.actor?.email ?? '',
        role: event.actor?.role ?? UserRole.STUDENT,
        reason: asRecord(event.payload).reason ?? null,
        createdAt: event.createdAt,
      }));
  }

  private quizzesFrom(
    events: Array<{
      id: string;
      liveSessionId: string;
      type: string;
      payload: Prisma.JsonValue | null;
      createdAt: Date;
      actorUserId: string | null;
    }>,
  ) {
    const answersByQuiz = new Map<string, number>();
    for (const event of events) {
      if (event.type !== 'QUIZ_ANSWERED') {
        continue;
      }
      const quizEventId = asRecord(event.payload).quizEventId?.toString();
      if (!quizEventId) {
        continue;
      }
      answersByQuiz.set(quizEventId, (answersByQuiz.get(quizEventId) ?? 0) + 1);
    }
    return events
      .filter((event) => event.type === 'QUIZ_LAUNCHED')
      .map((event) => ({
        id: event.id,
        liveSessionId: event.liveSessionId,
        createdAt: event.createdAt,
        ...asRecord(event.payload),
        answerCount: answersByQuiz.get(event.id) ?? 0,
      }));
  }

  private latestPayload(
    events: Array<{ type: string; payload: Prisma.JsonValue | null }>,
    type: string,
  ) {
    const event = [...events].reverse().find((item) => item.type === type);
    return asRecord(event?.payload);
  }
}

export const classroomService = new ClassroomService();
