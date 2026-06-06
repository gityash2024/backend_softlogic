import { LiveSessionStatus, Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/config';
import {
  AuthenticatedUserLike,
  canvasReadWhere,
  getManagedOrganizationIds,
  isAdminRole,
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
type ContentCanvas = Prisma.CanvasGetPayload<{
  include: {
    _count: { select: { slides: true; exports: true; liveSessions: true } };
    organization: { select: { id: true; name: true; kind: true } };
    user: { select: { id: true; email: true; name: true; role: true } };
    slides: true;
    exports: true;
    liveSessions: {
      include: {
        _count: {
          select: { participants: true; events: true; mediaAssets: true; recordings: true };
        };
        mediaAssets: true;
        recordings: true;
        events: {
          include: { actor: { select: { id: true; email: true; name: true; role: true } } };
        };
      };
    };
  };
}>;

const asRecord = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const dateLabel = (value: Date): string => value.toISOString();
const ACTIVITY_TYPES = [
  'SESSION_STARTED',
  'SESSION_ENDED',
  'HAND_RAISED',
  'QUIZ_LAUNCHED',
  'RECORDING_READY',
  'MEDIA_UPLOADED',
  'STUDENT_JOINED',
  'INVITE_SENT',
];

const displayUser = (
  actor?: { name: string | null; email: string; role: UserRole } | null,
): string | null => actor?.name || actor?.email || null;

const activityTitle = (value: string): string =>
  value
    .replace(/^classroom\./, '')
    .replace(/^canvas\./, 'board.')
    .replace(/^live_session\./, 'session.')
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .toLowerCase();

const readString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const looksLikeAssetUrl = (value: string): boolean =>
  value.startsWith('http://') ||
  value.startsWith('https://') ||
  value.startsWith('/storage/') ||
  value.startsWith('/api/') ||
  value.startsWith('file://');

export class ClassroomService {
  async getMe(user: ClassroomUser) {
    const [profile, sessions, canvases, teachers] = await Promise.all([
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
      this.listTeachers(user),
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

    const recentActivity = await this.listContentActivity(user, { limit: 20 });

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
      teachers,
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
      notifications: recentActivity,
      participants: activeSession?.participants ?? [],
      raisedHands: this.raisedHandsFrom(events),
      controls: this.latestPayload(events, 'CONTROLS_UPDATED'),
      quizzes: this.quizzesFrom(events),
      events,
    };
  }

  private async listCanvases(user: ClassroomUser) {
    const where = await canvasReadWhere(user);

    return prisma.canvas.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { slides: true } } },
      take: 100,
    });
  }

  async listContentCanvases(user: ClassroomUser) {
    const where = await canvasReadWhere(user);
    const canvases = await prisma.canvas.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { slides: true, exports: true, liveSessions: true } },
        organization: { select: { id: true, name: true, kind: true } },
        user: { select: { id: true, email: true, name: true, role: true } },
        slides: { orderBy: { order: 'asc' }, take: 1 },
        exports: {
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
        liveSessions: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: {
            _count: {
              select: {
                participants: true,
                events: true,
                mediaAssets: true,
                recordings: true,
              },
            },
            mediaAssets: { orderBy: { createdAt: 'desc' }, take: 25 },
            recordings: { orderBy: { createdAt: 'desc' }, take: 25 },
            events: {
              include: {
                actor: { select: { id: true, email: true, name: true, role: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
      },
      take: 100,
    });

    return canvases.map((canvas) => this.contentCanvasSummary(canvas));
  }

  async getContentCanvas(user: ClassroomUser, canvasId: string) {
    const where = await canvasReadWhere(user);
    const canvas = await prisma.canvas.findFirst({
      where: { AND: [{ id: canvasId }, where] },
      include: {
        _count: { select: { slides: true, exports: true, liveSessions: true } },
        organization: { select: { id: true, name: true, kind: true } },
        user: { select: { id: true, email: true, name: true, role: true } },
        slides: { orderBy: { order: 'asc' }, take: 50 },
        exports: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        liveSessions: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            _count: {
              select: {
                participants: true,
                events: true,
                mediaAssets: true,
                recordings: true,
              },
            },
            mediaAssets: { orderBy: { createdAt: 'desc' }, take: 100 },
            recordings: { orderBy: { createdAt: 'desc' }, take: 100 },
            events: {
              include: {
                actor: { select: { id: true, email: true, name: true, role: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 50,
            },
          },
        },
      },
    });

    if (!canvas) {
      return null;
    }

    return {
      ...this.contentCanvasSummary(canvas),
      slides: canvas.slides.map((slide) => ({
        id: slide.id,
        title: slide.name,
        order: slide.order,
        thumbnail: slide.thumbnail,
        elements: slide.elements,
        updatedAt: slide.updatedAt,
      })),
      exports: canvas.exports.map((item) => ({
        id: item.id,
        format: item.format,
        status: item.status,
        fileUrl: item.fileUrl,
        fileSize: item.fileSize,
        createdAt: item.createdAt,
        completedAt: item.completedAt,
      })),
      liveSessions: canvas.liveSessions.map((session) => ({
        id: session.id,
        title: session.title,
        status: session.status,
        joinCode: session.joinCode,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt,
        participantCount: session._count.participants,
        activityCount: session._count.events,
        mediaCount: session._count.mediaAssets,
        recordingCount: session._count.recordings,
      })),
      activity: await this.listContentActivity(user, { canvasId: canvas.id, limit: 100 }),
    };
  }

  async listContentActivity(
    user: ClassroomUser,
    options: { canvasId?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const canvasWhere = await canvasReadWhere(user);
    const canvasRows = await prisma.canvas.findMany({
      where: {
        AND: [
          canvasWhere,
          ...(options.canvasId ? [{ id: options.canvasId }] : []),
        ],
      },
      select: { id: true },
      take: 500,
    });
    const canvasIds = canvasRows.map((canvas) => canvas.id);
    if (canvasIds.length === 0) {
      return [];
    }

    const sessions = await prisma.liveSession.findMany({
      where: { canvasId: { in: canvasIds } },
      select: { id: true, canvasId: true, title: true },
      take: 1000,
    });
    const sessionIds = sessions.map((session) => session.id);

    const [events, audits] = await Promise.all([
      sessionIds.length > 0
        ? prisma.liveSessionEvent.findMany({
            where: { liveSessionId: { in: sessionIds } },
            include: {
              actor: { select: { id: true, email: true, name: true, role: true } },
              liveSession: { select: { id: true, canvasId: true, title: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit * 3,
          })
        : [],
      prisma.adminAuditLog.findMany({
        where: {
          OR: [
            { targetType: 'canvas', targetId: { in: canvasIds } },
            { targetType: 'board', targetId: { in: canvasIds } },
            ...(sessionIds.length > 0
              ? [
                  { targetType: 'liveSession', targetId: { in: sessionIds } },
                  { targetType: 'live_session', targetId: { in: sessionIds } },
                ]
              : []),
            { actorUserId: user.userId, targetType: { in: ['export', 'media'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 3,
      }),
    ]);

    const sessionCanvas = new Map(sessions.map((session) => [session.id, session.canvasId]));
    const auditActorIds = [...new Set(audits.map((audit) => audit.actorUserId))];
    const auditActors = auditActorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: auditActorIds } },
          select: { id: true, email: true, name: true, role: true },
        })
      : [];
    const auditActorById = new Map(auditActors.map((actor) => [actor.id, actor]));
    const items = [
      ...events
        .filter((event) => ACTIVITY_TYPES.includes(event.type))
        .map((event) => ({
          id: event.id,
          source: 'liveSessionEvent',
          type: event.type,
          title: activityTitle(event.type),
          actorName: displayUser(event.actor),
          actorRole: event.actor?.role ?? null,
          canvasId: event.liveSession.canvasId,
          liveSessionId: event.liveSessionId,
          createdAt: event.createdAt,
          payload: asRecord(event.payload),
        })),
      ...audits.map((audit) => ({
        id: audit.id,
        source: 'audit',
        type: audit.action,
        title: audit.summary || activityTitle(audit.action),
        actorName: displayUser(auditActorById.get(audit.actorUserId)),
        actorRole: auditActorById.get(audit.actorUserId)?.role ?? null,
        canvasId:
          audit.targetType === 'canvas' || audit.targetType === 'board'
            ? audit.targetId
            : audit.targetType === 'liveSession' || audit.targetType === 'live_session'
              ? audit.targetId
                ? sessionCanvas.get(audit.targetId) ?? null
                : null
              : null,
        liveSessionId:
          audit.targetType === 'liveSession' || audit.targetType === 'live_session'
            ? audit.targetId
            : null,
        createdAt: audit.createdAt,
        payload: asRecord(audit.metadata),
      })),
    ];

    return items
      .filter((item) => !options.canvasId || item.canvasId === options.canvasId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private async listTeachers(user: ClassroomUser) {
    if (!isAdminRole(user.role)) {
      return [];
    }
    const organizationIds = await getManagedOrganizationIds(user);
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        role: UserRole.TEACHER,
        ...(organizationIds && organizationIds.length > 0
          ? { primaryOrganizationId: { in: organizationIds } }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        primaryOrganizationId: true,
        primaryOrganization: {
          select: {
            id: true,
            name: true,
          },
        },
        lastLoginAt: true,
      },
      orderBy: [{ primaryOrganization: { name: 'asc' } }, { name: 'asc' }],
      take: 200,
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

  private contentCanvasSummary(canvas: ContentCanvas) {
    const firstSlide = canvas.slides[0] ?? null;
    const slideAssets = canvas.slides.flatMap((slide) =>
      this.extractSlideAssets(slide.elements, {
        canvasId: canvas.id,
        slideId: slide.id,
        slideTitle: slide.name ?? 'Slide',
        updatedAt: slide.updatedAt,
      }),
    );
    const liveMedia = canvas.liveSessions.flatMap((session) =>
      session.mediaAssets.map((asset) => ({
        id: asset.id,
        source: 'liveSessionMedia',
        type: asset.kind,
        title: asset.fileName,
        url: asset.publicUrl,
        canvasId: canvas.id,
        liveSessionId: session.id,
        createdAt: asset.createdAt,
      })),
    );
    const recordings = canvas.liveSessions.flatMap((session) =>
      session.recordings.map((recording) => ({
        id: recording.id,
        source: 'recording',
        type: 'RECORDING',
        title: `Recording ${dateLabel(recording.createdAt)}`,
        url: recording.publicUrl,
        canvasId: canvas.id,
        liveSessionId: session.id,
        createdAt: recording.createdAt,
      })),
    );

    return {
      id: canvas.id,
      title: canvas.name,
      description: canvas.description,
      thumbnail: canvas.thumbnail ?? firstSlide?.thumbnail ?? null,
      createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt,
      createdBy: canvas.user,
      organization: canvas.organization,
      firstSlide: firstSlide
        ? {
            id: firstSlide.id,
            title: firstSlide.name ?? 'Slide',
            order: firstSlide.order,
            thumbnail: firstSlide.thumbnail,
            elements: firstSlide.elements,
          }
        : null,
      counts: {
        slides: canvas._count.slides,
        exports: canvas._count.exports,
        liveSessions: canvas._count.liveSessions,
        imports: slideAssets.length + liveMedia.length,
        recordings: recordings.length,
        activity:
          canvas.liveSessions.reduce(
            (total, session) => total + session._count.events,
            0,
          ) ?? 0,
      },
      assets: [...slideAssets, ...liveMedia, ...recordings].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    };
  }

  private extractSlideAssets(
    value: Prisma.JsonValue,
    context: { canvasId: string; slideId: string; slideTitle: string; updatedAt: Date },
  ) {
    const assets: Array<{
      id: string;
      source: string;
      type: string;
      title: string;
      url: string;
      canvasId: string;
      slideId: string;
      createdAt: Date;
    }> = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const record = node as Record<string, unknown>;
      const url = readString(record, [
        'mediaPath',
        'sourceUrl',
        'publicUrl',
        'fileUrl',
        'renderedImagePath',
      ]);
      if (url && looksLikeAssetUrl(url)) {
        assets.push({
          id: readString(record, ['id', 'mediaId', 'assetId']) ?? `${context.slideId}-${assets.length}`,
          source: 'slideElement',
          type: readString(record, ['contentType', 'mediaType', 'type']) ?? 'MEDIA',
          title:
            readString(record, ['fileName', 'name', 'title', 'label']) ??
            context.slideTitle ??
            'Imported media',
          url,
          canvasId: context.canvasId,
          slideId: context.slideId,
          createdAt: context.updatedAt,
        });
      }
      Object.values(record).forEach(visit);
    };

    visit(value);
    return assets;
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
