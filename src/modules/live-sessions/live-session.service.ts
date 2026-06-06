import { randomBytes, createHash } from "crypto";
import path from "path";

import {
  LiveSessionMediaKind,
  LiveSessionMessageType,
  LiveSessionParticipantRole,
  LiveSessionRecordingStatus,
  LiveSessionStatus,
  OtpType,
  Prisma,
  UserRole,
  UserStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { env, prisma } from "@/config";
import {
  AuthenticatedUserLike,
  ensureCanvasAccess,
  ensureCanvasWriteAccess,
  getLinkedStudentIdsForParent,
  getManagedOrganizationIds,
  isAdminRole,
} from "@/shared/utils/access-control";
import {
  getBrandLogoEmailAttachments,
  getLiveSessionInviteEmailHtml,
  sendEmail,
  sendPasswordSetupEmail,
  sendWelcomeEmail,
} from "@/shared/utils/email";
import { AppError } from "@/shared/errors/AppError";
import { fileStorageService } from "@/shared/services/file-storage.service";

const DEFAULT_STUDENT_PERMISSIONS = {
  chat: true,
  audio: true,
  video: true,
  boardView: true,
  boardActivity: true,
  boardEdit: false,
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const hashCode = (code: string): string =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

const generateJoinCode = (): string =>
  randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

const DEFAULT_SESSION_CODE_TTL_MINUTES = 240;
const PASSWORD_SETUP_EXPIRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const toJsonInput = (
  value?: Record<string, unknown>,
): Prisma.InputJsonValue | undefined =>
  value as Prisma.InputJsonValue | undefined;

const canHostLiveSession = (role: UserRole): boolean =>
  role === UserRole.TEACHER || isAdminRole(role);

const participantRoleFor = (role: UserRole): LiveSessionParticipantRole => {
  if (isAdminRole(role)) {
    return LiveSessionParticipantRole.TEACHER;
  }
  if (role === UserRole.TEACHER) {
    return LiveSessionParticipantRole.TEACHER;
  }
  return LiveSessionParticipantRole.STUDENT;
};

export class LiveSessionService {
  async createSession(
    user: AuthenticatedUserLike,
    input: {
      canvasId: string;
      title?: string;
      studentPermissions?: Record<string, unknown>;
    },
  ) {
    if (!canHostLiveSession(user.role)) {
      throw new AppError(
        "Only teachers and admins can create live sessions",
        403,
      );
    }

    const canvas = await ensureCanvasWriteAccess(input.canvasId, user);
    const liveSession = await prisma.liveSession.create({
      data: {
        canvasId: canvas.id,
        organizationId: canvas.organizationId,
        title: input.title ?? canvas.name,
        createdById: user.userId,
        hostUserId: user.userId,
        studentPermissions: {
          ...DEFAULT_STUDENT_PERMISSIONS,
          ...(input.studentPermissions ?? {}),
        },
      },
      include: this.includeSummary(),
    });

    await this.writeEvent(liveSession.id, user.userId, "SESSION_CREATED", {
      canvasId: canvas.id,
    });

    return liveSession;
  }

  async getSession(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureSessionAccess(user, liveSessionId);
    return prisma.liveSession.findUniqueOrThrow({
      where: { id: liveSessionId },
      include: this.includeSummary(),
    });
  }

  async listSessions(
    user: AuthenticatedUserLike & { email?: string },
    input: { status?: LiveSessionStatus } = {},
  ) {
    const where: Prisma.LiveSessionWhereInput = {};
    if (input.status) {
      where.status = input.status;
    }

    if (user.role === UserRole.TEACHER) {
      where.OR = [
        { createdById: user.userId },
        { hostUserId: user.userId },
        { canvas: { userId: user.userId } },
      ];
    } else if (user.role === UserRole.STUDENT) {
      where.OR = [{ participants: { some: { userId: user.userId } } }];
    } else if (user.role === UserRole.PARENT) {
      const studentIds = await getLinkedStudentIdsForParent(user.userId);
      if (studentIds.length === 0) {
        return [];
      }
      where.OR = [
        { participants: { some: { userId: { in: studentIds } } } },
        { invites: { some: { invitedUserId: { in: studentIds } } } },
        { canvas: { userId: { in: studentIds } } },
      ];
    } else if (isAdminRole(user.role)) {
      const organizationIds = await getManagedOrganizationIds(user);
      if (organizationIds !== null) {
        where.organizationId = { in: organizationIds };
      }
    } else {
      throw new AppError("You do not have access to live sessions", 403);
    }

    return prisma.liveSession.findMany({
      where,
      include: this.includeSummary(),
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });
  }

  async startSession(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureHostAccess(user, liveSessionId);
    const existing = await prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: {
        hostUserId: true,
        organizationId: true,
        canvas: { select: { organizationId: true } },
      },
    });
    const liveSession = await prisma.liveSession.update({
      where: { id: liveSessionId },
      data: {
        status: LiveSessionStatus.LIVE,
        startedAt: new Date(),
        endedAt: null,
        hostUserId: existing?.hostUserId ?? user.userId,
        organizationId:
          existing?.organizationId ?? existing?.canvas?.organizationId ?? null,
      },
      include: this.includeSummary(),
    });
    await this.writeEvent(liveSessionId, user.userId, "SESSION_STARTED");
    return liveSession;
  }

  async endSession(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureHostAccess(user, liveSessionId);
    const liveSession = await prisma.liveSession.update({
      where: { id: liveSessionId },
      data: {
        status: LiveSessionStatus.ENDED,
        endedAt: new Date(),
      },
      include: this.includeSummary(),
    });
    await prisma.liveSessionParticipant.updateMany({
      where: { liveSessionId, leftAt: null },
      data: { leftAt: new Date() },
    });
    await this.writeEvent(liveSessionId, user.userId, "SESSION_ENDED");
    return liveSession;
  }

  async generateSessionJoinCode(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: { expiresInMinutes?: number; forceRefresh?: boolean } = {},
  ) {
    const liveSession = await this.ensureHostAccess(user, liveSessionId);
    const now = new Date();
    if (
      !input.forceRefresh &&
      liveSession.joinCode &&
      liveSession.joinCodeExpiresAt &&
      liveSession.joinCodeExpiresAt > now
    ) {
      return {
        liveSessionId,
        canvasId: liveSession.canvasId,
        title: liveSession.title ?? "Live Session",
        code: liveSession.joinCode,
        expiresAt: liveSession.joinCodeExpiresAt,
      };
    }

    const code = generateJoinCode();
    const expiresInMinutes =
      input.expiresInMinutes ?? DEFAULT_SESSION_CODE_TTL_MINUTES;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    await prisma.liveSession.update({
      where: { id: liveSessionId },
      data: {
        joinCode: code,
        joinCodeHash: hashCode(code),
        joinCodeExpiresAt: expiresAt,
      },
    });
    await this.writeEvent(
      liveSessionId,
      user.userId,
      "SESSION_JOIN_CODE_CREATED",
    );
    return {
      liveSessionId,
      canvasId: liveSession.canvasId,
      title: liveSession.title ?? "Live Session",
      code,
      expiresAt,
    };
  }

  async getSessionJoinCode(user: AuthenticatedUserLike, liveSessionId: string) {
    const liveSession = await this.ensureHostAccess(user, liveSessionId);
    if (
      !liveSession.joinCode ||
      !liveSession.joinCodeExpiresAt ||
      liveSession.joinCodeExpiresAt <= new Date()
    ) {
      return null;
    }
    return {
      liveSessionId,
      canvasId: liveSession.canvasId,
      title: liveSession.title ?? "Live Session",
      code: liveSession.joinCode,
      expiresAt: liveSession.joinCodeExpiresAt,
    };
  }

  async inviteStudent(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: {
      email: string;
      downloadPageUrl?: string;
      expiresInMinutes: number;
    },
  ) {
    const liveSession = await this.ensureHostAccess(user, liveSessionId);
    const email = normalizeEmail(input.email);
    const code = generateJoinCode();
    const codeExpiresAt = new Date(
      Date.now() + input.expiresInMinutes * 60 * 1000,
    );
    const downloadPageUrl =
      input.downloadPageUrl ?? env.PUBLIC_DOWNLOAD_PAGE_URL;
    const existingInvitedUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    const invitedUser = await prisma.user.upsert({
      where: { email },
      update: {
        invitedById: user.userId,
        primaryOrganizationId: liveSession.organizationId,
      },
      create: {
        email,
        name: email.split("@")[0],
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        invitedById: user.userId,
        primaryOrganizationId: liveSession.organizationId,
      },
    });

    if (!existingInvitedUser) {
      const organization = liveSession.organizationId
        ? await prisma.organization.findUnique({
            where: { id: liveSession.organizationId },
            select: { name: true, studentLoginEnabled: true },
          })
        : null;
      if (organization?.studentLoginEnabled) {
        const setupToken = await this.createPasswordSetupToken(invitedUser.id);
        await sendPasswordSetupEmail({
          to: invitedUser.email,
          name: invitedUser.name,
          role: invitedUser.role,
          organizationName: organization.name,
          setupUrl: this.passwordSetupUrl(setupToken),
          expiresInLabel: `${PASSWORD_SETUP_EXPIRY_DAYS} days`,
        });
      } else {
        await sendWelcomeEmail({
          to: invitedUser.email,
          name: invitedUser.name,
          role: invitedUser.role,
          inviterName:
            liveSession.createdBy.name ?? liveSession.createdBy.email,
          downloadPageUrl,
        });
      }
    }

    if (liveSession.organizationId) {
      await prisma.organizationMembership.upsert({
        where: {
          userId_organizationId: {
            userId: invitedUser.id,
            organizationId: liveSession.organizationId,
          },
        },
        update: {},
        create: {
          userId: invitedUser.id,
          organizationId: liveSession.organizationId,
        },
      });
    }

    const invite = await prisma.liveSessionInvite.create({
      data: {
        liveSessionId,
        email,
        invitedUserId: invitedUser.id,
        invitedById: user.userId,
        codeHash: hashCode(code),
        codeExpiresAt,
        downloadPageUrl,
      },
    });

    await sendEmail({
      to: email,
      subject: `SoftLogic live session code: ${code}`,
      html: getLiveSessionInviteEmailHtml({
        code,
        teacherName: liveSession.createdBy.name ?? liveSession.createdBy.email,
        sessionTitle: liveSession.title ?? "Live Session",
        downloadPageUrl,
      }),
      attachments: getBrandLogoEmailAttachments(),
    });

    await this.writeEvent(liveSessionId, user.userId, "INVITE_SENT", { email });

    return {
      id: invite.id,
      email: invite.email,
      codeExpiresAt: invite.codeExpiresAt,
      downloadPageUrl,
    };
  }

  async verifyJoinCode(code: string) {
    const sessionCode = await this.findActiveSessionByCode(code);
    if (sessionCode) {
      return {
        liveSessionId: sessionCode.id,
        title: sessionCode.title,
        canvasId: sessionCode.canvasId,
        email: "",
        expiresAt: sessionCode.joinCodeExpiresAt,
      };
    }

    const invite = await this.findActiveInviteByCode(code);
    return {
      liveSessionId: invite.liveSessionId,
      title: invite.liveSession.title,
      canvasId: invite.liveSession.canvasId,
      email: invite.email,
      expiresAt: invite.codeExpiresAt,
    };
  }

  async verifySessionOnlyJoinCode(code: string) {
    const liveSession = await this.findActiveSessionByCode(code);
    if (!liveSession) {
      throw new AppError("Invalid or expired session code", 404);
    }
    await this.ensureSessionOnlyAllowed(liveSession.organizationId);
    return {
      liveSessionId: liveSession.id,
      title: liveSession.title,
      canvasId: liveSession.canvasId,
      organizationId: liveSession.organizationId,
      expiresAt: liveSession.joinCodeExpiresAt,
      sessionOnly: true,
    };
  }

  async joinSessionOnlyByCode(input: { code: string; displayName?: string }) {
    const liveSession = await this.findActiveSessionByCode(input.code);
    if (!liveSession) {
      throw new AppError("Invalid or expired session code", 404);
    }
    await this.ensureSessionOnlyAllowed(liveSession.organizationId);
    const token = randomBytes(24).toString("base64url");
    const guest = await prisma.liveSessionGuestParticipant.create({
      data: {
        liveSessionId: liveSession.id,
        organizationId: liveSession.organizationId,
        displayName: input.displayName?.trim() || "Student",
        joinTokenHash: createHash("sha256").update(token).digest("hex"),
        role: LiveSessionParticipantRole.STUDENT,
        expiresAt:
          liveSession.joinCodeExpiresAt ??
          new Date(Date.now() + DEFAULT_SESSION_CODE_TTL_MINUTES * 60 * 1000),
        joinedAt: new Date(),
        metadata: { joinMode: "SESSION_ONLY_QR" },
      },
    });
    await this.writeEvent(liveSession.id, null, "SESSION_ONLY_STUDENT_JOINED", {
      guestParticipantId: guest.id,
      displayName: guest.displayName,
    });
    return {
      liveSession,
      guestParticipant: guest,
      guestJoinToken: token,
    };
  }

  async joinByCode(
    user: AuthenticatedUserLike & { email?: string },
    code: string,
  ) {
    const sessionCode = await this.findActiveSessionByCode(code);
    if (sessionCode) {
      const participant = await prisma.liveSessionParticipant.upsert({
        where: {
          liveSessionId_userId: {
            liveSessionId: sessionCode.id,
            userId: user.userId,
          },
        },
        update: {
          leftAt: null,
          role: participantRoleFor(user.role),
        },
        create: {
          liveSessionId: sessionCode.id,
          userId: user.userId,
          role: participantRoleFor(user.role),
        },
      });

      await this.writeEvent(sessionCode.id, user.userId, "SESSION_CODE_USED");

      return {
        liveSession: sessionCode,
        participant,
      };
    }

    const invite = await this.findActiveInviteByCode(code);
    const userEmail = normalizeEmail(user.email ?? "");
    if (
      userEmail &&
      userEmail !== invite.email &&
      user.role === UserRole.STUDENT
    ) {
      throw new AppError("This code was issued for another student email", 403);
    }

    const participant = await prisma.liveSessionParticipant.upsert({
      where: {
        liveSessionId_userId: {
          liveSessionId: invite.liveSessionId,
          userId: user.userId,
        },
      },
      update: {
        leftAt: null,
        role: participantRoleFor(user.role),
      },
      create: {
        liveSessionId: invite.liveSessionId,
        userId: user.userId,
        role: participantRoleFor(user.role),
      },
    });

    await prisma.liveSessionInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), invitedUserId: user.userId },
    });

    await this.writeEvent(invite.liveSessionId, user.userId, "JOIN_CODE_USED");

    return {
      liveSession: invite.liveSession,
      participant,
    };
  }

  async listMessages(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureSessionAccess(user, liveSessionId);
    return prisma.liveSessionMessage.findMany({
      where: { liveSessionId },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 250,
    });
  }

  async sendMessage(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: {
      type: LiveSessionMessageType;
      body?: string;
      attachmentUrl?: string;
      attachmentName?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.ensureSessionAccess(user, liveSessionId);
    const message = await prisma.liveSessionMessage.create({
      data: {
        liveSessionId,
        senderUserId: user.userId,
        type: input.type,
        body: input.body,
        attachmentUrl: input.attachmentUrl,
        attachmentName: input.attachmentName,
        metadata: toJsonInput(input.metadata),
      },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    await this.writeEvent(liveSessionId, user.userId, "CHAT_MESSAGE_SENT", {
      messageId: message.id,
    });
    return message;
  }

  async createMediaAsset(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: {
      kind: LiveSessionMediaKind;
      publicUrl?: string;
      metadata?: Record<string, unknown>;
    },
    file?: Express.Multer.File,
  ) {
    await this.ensureSessionAccess(user, liveSessionId);
    if (user.role === UserRole.STUDENT) {
      throw new AppError("Students cannot upload live-session media", 403);
    }
    if (!file && !input.publicUrl) {
      throw new AppError("A file or publicUrl is required", 400);
    }
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { organizationId: true },
    });
    await this.ensureOrganizationStorageReady(
      liveSession?.organizationId ?? null,
    );

    const storedFile = file
      ? await fileStorageService.storeFile(
          `live-sessions/${liveSessionId}`,
          file,
        )
      : null;
    const storageKey = storedFile?.storageKey ?? input.publicUrl!;
    const publicUrl = input.publicUrl ?? storedFile!.publicUrl;

    const media = await prisma.liveSessionMediaAsset.create({
      data: {
        liveSessionId,
        uploadedById: user.userId,
        kind: input.kind,
        fileName: storedFile?.fileName ?? path.basename(input.publicUrl!),
        mimeType: storedFile?.mimeType ?? "text/uri-list",
        sizeBytes: storedFile?.sizeBytes ?? 0,
        storageKey,
        publicUrl,
        metadata: toJsonInput(input.metadata),
      },
    });

    await this.writeEvent(liveSessionId, user.userId, "MEDIA_UPLOADED", {
      mediaId: media.id,
    });
    return media;
  }

  async createRecording(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: {
      status: LiveSessionRecordingStatus;
      publicUrl?: string;
      storageKey?: string;
      durationSeconds?: number;
      metadata?: Record<string, unknown>;
    },
    file?: Express.Multer.File,
  ) {
    const liveSession = await this.ensureHostAccess(user, liveSessionId);
    await this.ensureOrganizationStorageReady(liveSession.organizationId);
    const storedFile = file
      ? await fileStorageService.storeFile(
          `live-sessions/${liveSessionId}`,
          file,
        )
      : null;
    const storageKey = storedFile?.storageKey ?? input.storageKey;

    const recording = await prisma.liveSessionRecording.create({
      data: {
        liveSessionId,
        createdById: user.userId,
        status:
          input.publicUrl || storageKey
            ? LiveSessionRecordingStatus.READY
            : input.status,
        storageKey,
        publicUrl:
          input.publicUrl ??
          storedFile?.publicUrl ??
          (storageKey
            ? fileStorageService.publicUrlFor(storageKey)
            : undefined),
        durationSeconds: input.durationSeconds,
        metadata: toJsonInput(input.metadata),
      },
    });

    await this.writeEvent(liveSessionId, user.userId, "RECORDING_READY", {
      recordingId: recording.id,
    });
    return recording;
  }

  async createShareUrl(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: { recordingId?: string; emailTo?: string },
  ) {
    await this.ensureSessionAccess(user, liveSessionId);
    const url = input.recordingId
      ? `${env.PUBLIC_APP_URL}/live-sessions/${liveSessionId}/recordings/${input.recordingId}`
      : `${env.PUBLIC_APP_URL}/live-sessions/${liveSessionId}`;

    if (input.emailTo) {
      await sendEmail({
        to: input.emailTo,
        subject: "SoftLogic live-session share link",
        html: `<p>A SoftLogic live-session link was shared with you:</p><p><a href="${url}">${url}</a></p>`,
      });
    }

    await this.writeEvent(liveSessionId, user.userId, "SHARE_URL_CREATED", {
      recordingId: input.recordingId,
      emailTo: input.emailTo,
    });
    return { url };
  }

  async listEvents(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureSessionAccess(user, liveSessionId);
    return prisma.liveSessionEvent.findMany({
      where: { liveSessionId },
      include: this.includeEventActor(),
      orderBy: { createdAt: "asc" },
      take: 500,
    });
  }

  async raiseHand(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: { reason?: string } = {},
  ) {
    await this.ensureSessionAccess(user, liveSessionId);
    return this.writeEvent(liveSessionId, user.userId, "HAND_RAISED", {
      reason: input.reason?.trim() || null,
    });
  }

  async resolveHand(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    handEventId: string,
    input: { resolution?: string } = {},
  ) {
    await this.ensureHostAccess(user, liveSessionId);
    const handEvent = await prisma.liveSessionEvent.findFirst({
      where: { id: handEventId, liveSessionId, type: "HAND_RAISED" },
      select: { id: true, actorUserId: true },
    });
    if (!handEvent) {
      throw new AppError("Raised hand not found", 404);
    }
    return this.writeEvent(liveSessionId, user.userId, "HAND_RESOLVED", {
      handEventId,
      studentUserId: handEvent.actorUserId,
      resolution: input.resolution ?? "ALLOWED",
    });
  }

  async updateControls(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: Record<string, unknown>,
  ) {
    await this.ensureHostAccess(user, liveSessionId);
    return this.writeEvent(
      liveSessionId,
      user.userId,
      "CONTROLS_UPDATED",
      input,
    );
  }

  async launchQuiz(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    input: {
      question: string;
      options: string[];
      correctIndex?: number;
      durationSeconds?: number;
    },
  ) {
    await this.ensureHostAccess(user, liveSessionId);
    return this.writeEvent(liveSessionId, user.userId, "QUIZ_LAUNCHED", input);
  }

  async answerQuiz(
    user: AuthenticatedUserLike,
    liveSessionId: string,
    quizEventId: string,
    input: { answer: string },
  ) {
    await this.ensureSessionAccess(user, liveSessionId);
    const quizEvent = await prisma.liveSessionEvent.findFirst({
      where: { id: quizEventId, liveSessionId, type: "QUIZ_LAUNCHED" },
      select: { id: true },
    });
    if (!quizEvent) {
      throw new AppError("Quiz not found", 404);
    }
    return this.writeEvent(liveSessionId, user.userId, "QUIZ_ANSWERED", {
      quizEventId,
      answer: input.answer,
    });
  }

  async listMediaAssets(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureSessionAccess(user, liveSessionId);
    return prisma.liveSessionMediaAsset.findMany({
      where: { liveSessionId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async listRecordings(user: AuthenticatedUserLike, liveSessionId: string) {
    await this.ensureSessionAccess(user, liveSessionId);
    return prisma.liveSessionRecording.findMany({
      where: { liveSessionId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async createCallToken(user: AuthenticatedUserLike, liveSessionId: string) {
    const liveSession = await this.ensureSessionAccess(user, liveSessionId);
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      return {
        provider: "turn-only",
        livekitUrl: null,
        token: null,
        iceServers: this.iceServers(),
      };
    }

    const canPublish =
      user.role === UserRole.STUDENT
        ? this.studentCanPublish(liveSession.studentPermissions)
        : true;
    const token = jwt.sign(
      {
        iss: env.LIVEKIT_API_KEY,
        sub: user.userId,
        video: {
          roomJoin: true,
          room: `live-session-${liveSessionId}`,
          canPublish,
          canSubscribe: true,
        },
      },
      env.LIVEKIT_API_SECRET,
      { algorithm: "HS256", expiresIn: "2h" },
    );

    return {
      provider: "livekit",
      livekitUrl: env.LIVEKIT_URL,
      token,
      iceServers: this.iceServers(),
    };
  }

  async writeEvent(
    liveSessionId: string,
    actorUserId: string | null,
    type: string,
    payload?: Record<string, unknown>,
  ) {
    return prisma.liveSessionEvent.create({
      data: {
        liveSessionId,
        actorUserId,
        type,
        payload: toJsonInput(payload),
      },
      include: this.includeEventActor(),
    });
  }

  async ensureSessionAccess(
    user: AuthenticatedUserLike,
    liveSessionId: string,
  ) {
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      include: {
        participants: { where: { userId: user.userId } },
        invites: { where: { invitedUserId: user.userId } },
        canvas: { select: { userId: true } },
      },
    });
    if (!liveSession) {
      throw new AppError("Live session not found", 404);
    }
    const linkedStudentIds =
      user.role === UserRole.PARENT
        ? await getLinkedStudentIdsForParent(user.userId)
        : [];
    const parentCanView =
      linkedStudentIds.length > 0 &&
      (await prisma.liveSession.count({
        where: {
          id: liveSessionId,
          OR: [
            { participants: { some: { userId: { in: linkedStudentIds } } } },
            { invites: { some: { invitedUserId: { in: linkedStudentIds } } } },
            { canvas: { userId: { in: linkedStudentIds } } },
          ],
        },
      })) > 0;
    const adminCanManage = isAdminRole(user.role)
      ? await this.adminCanManageOrganization(user, liveSession.organizationId)
      : false;
    const teacherOwnsCanvas =
      user.role === UserRole.TEACHER &&
      liveSession.canvas?.userId === user.userId;
    if (
      adminCanManage ||
      liveSession.createdById === user.userId ||
      liveSession.hostUserId === user.userId ||
      teacherOwnsCanvas ||
      liveSession.participants.length > 0 ||
      (user.role !== UserRole.STUDENT && liveSession.invites.length > 0) ||
      parentCanView
    ) {
      return liveSession;
    }
    throw new AppError("You do not have access to this live session", 403);
  }

  private async ensureHostAccess(
    user: AuthenticatedUserLike,
    liveSessionId: string,
  ) {
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      include: {
        createdBy: { select: { id: true, email: true, name: true } },
        canvas: { select: { userId: true, organizationId: true } },
      },
    });
    if (!liveSession) {
      throw new AppError("Live session not found", 404);
    }
    const adminCanManage = isAdminRole(user.role)
      ? await this.adminCanManageOrganization(user, liveSession.organizationId)
      : false;
    const teacherOwnsCanvas =
      user.role === UserRole.TEACHER &&
      liveSession.canvas?.userId === user.userId;
    if (
      adminCanManage ||
      liveSession.createdById === user.userId ||
      liveSession.hostUserId === user.userId ||
      teacherOwnsCanvas
    ) {
      return liveSession;
    }
    throw new AppError(
      "Only the teacher host can manage this live session",
      403,
    );
  }

  private async adminCanManageOrganization(
    user: AuthenticatedUserLike,
    organizationId: string | null,
  ): Promise<boolean> {
    if (!isAdminRole(user.role)) {
      return false;
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }
    if (!organizationId) {
      return false;
    }
    const organizationIds = await getManagedOrganizationIds(user);
    return organizationIds?.includes(organizationId) ?? false;
  }

  private async findActiveInviteByCode(code: string) {
    const invite = await prisma.liveSessionInvite.findFirst({
      where: {
        codeHash: hashCode(code),
        codeExpiresAt: { gt: new Date() },
        usedAt: null,
      },
      include: {
        liveSession: {
          include: this.includeSummary(),
        },
      },
    });
    if (!invite) {
      throw new AppError("Invalid or expired session code", 404);
    }
    return invite;
  }

  private async findActiveSessionByCode(code: string) {
    return prisma.liveSession.findFirst({
      where: {
        joinCodeHash: hashCode(code),
        joinCodeExpiresAt: { gt: new Date() },
        status: { in: [LiveSessionStatus.SCHEDULED, LiveSessionStatus.LIVE] },
      },
      include: this.includeSummary(),
    });
  }

  private async ensureSessionOnlyAllowed(organizationId: string | null) {
    if (!organizationId) {
      throw new AppError(
        "Session-only join requires an organization-scoped session",
        403,
      );
    }
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        sessionOnlyJoinEnabled: true,
        studentLoginEnabled: true,
        status: true,
      },
    });
    if (!organization || organization.status !== "ACTIVE") {
      throw new AppError("Organization is not active for session join", 403);
    }
    if (
      !organization.sessionOnlyJoinEnabled ||
      organization.studentLoginEnabled
    ) {
      throw new AppError(
        "Session-only QR access is not enabled for this organization",
        403,
      );
    }
  }

  private async createPasswordSetupToken(userId: string): Promise<string> {
    await prisma.otp.updateMany({
      where: { userId, type: OtpType.PASSWORD_RESET, usedAt: null },
      data: { usedAt: new Date() },
    });
    const secret = randomBytes(32).toString("hex");
    const otp = await prisma.otp.create({
      data: {
        userId,
        type: OtpType.PASSWORD_RESET,
        code: await bcrypt.hash(secret, 10),
        expiresAt: new Date(Date.now() + PASSWORD_SETUP_EXPIRY_DAYS * DAY_MS),
      },
    });
    return `${otp.id}.${secret}`;
  }

  private passwordSetupUrl(token: string): string {
    const baseUrl = (env.PUBLIC_ADMIN_URL || env.PUBLIC_APP_URL).replace(
      /\/+$/,
      "",
    );
    return `${baseUrl}/setup-password?token=${encodeURIComponent(token)}`;
  }

  private async ensureOrganizationStorageReady(organizationId: string | null) {
    if (!organizationId) return;
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storageStatus: true, storageProvider: true },
    });
    if (
      !organization?.storageProvider ||
      organization.storageStatus !== "CONNECTED"
    ) {
      throw new AppError(
        "Organization cloud storage must be connected before saving organization content",
        403,
      );
    }
  }

  private studentCanPublish(value: Prisma.JsonValue): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const permissions = value as Record<string, unknown>;
    return permissions.audio === true || permissions.video === true;
  }

  private iceServers() {
    const urls = env.TURN_URLS
      ? env.TURN_URLS.split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    if (urls.length === 0) {
      return [];
    }
    return [
      {
        urls,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      },
    ];
  }

  private includeSummary() {
    return {
      canvas: { select: { id: true, name: true, organizationId: true } },
      organization: { select: { id: true, name: true } },
      createdBy: { select: { id: true, email: true, name: true, role: true } },
      host: { select: { id: true, email: true, name: true, role: true } },
      participants: {
        include: {
          user: { select: { id: true, email: true, name: true, role: true } },
        },
      },
    };
  }

  private includeEventActor() {
    return {
      actor: { select: { id: true, email: true, name: true, role: true } },
    };
  }
}

export const liveSessionService = new LiveSessionService();
