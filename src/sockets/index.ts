import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyAccessToken } from "@/shared/utils/jwt";
import {
  ensureCanvasAccess,
  AuthenticatedUserLike,
} from "@/shared/utils/access-control";
import { prisma } from "@/config";
import { liveSessionService } from "@/modules/live-sessions/live-session.service";

interface SocketUserContext extends AuthenticatedUserLike {
  email: string;
}

const canHostSocketLiveSession = (role: string): boolean =>
  role === "TEACHER" ||
  role === "ADMIN" ||
  role === "CUSTOMER_ADMIN" ||
  role === "PARTNER_ADMIN" ||
  role === "SUPER_ADMIN";

const socketParticipantRole = (role: string): "TEACHER" | "STUDENT" =>
  canHostSocketLiveSession(role) ? "TEACHER" : "STUDENT";

const resolveSocketToken = (
  authorization?: string,
  authToken?: unknown,
): string | null => {
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken.trim();
  }

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
};

export const setupSockets = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    try {
      const token = resolveSocketToken(
        socket.handshake.headers.authorization,
        socket.handshake.auth.token,
      );

      if (!token) {
        return next(new Error("Authentication token is required"));
      }

      socket.data.user = verifyAccessToken(token);
      return next();
    } catch {
      return next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as SocketUserContext | undefined;
    console.log(`Socket connected: ${socket.id} (${user?.email ?? "unknown"})`);

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });

    socket.on("join-canvas", async (canvasId: string) => {
      if (!user || !canvasId) {
        socket.emit("socket-error", { message: "Canvas id is required" });
        return;
      }

      try {
        const canvas = await ensureCanvasAccess(
          canvasId,
          user as AuthenticatedUserLike,
        );
        socket.join(`canvas:${canvasId}`);
        socket.emit("canvas-joined", {
          canvasId,
          organizationId: canvas.organizationId,
        });
      } catch (error) {
        socket.emit("socket-error", {
          message:
            error instanceof Error ? error.message : "Unable to join canvas",
        });
      }
    });

    socket.on("leave-canvas", (canvasId: string) => {
      socket.leave(`canvas:${canvasId}`);
    });

    socket.on(
      "join-live-session",
      async (payload: {
        canvasId: string;
        liveSessionId?: string;
        title?: string;
      }) => {
        if (!user || !payload?.canvasId) {
          socket.emit("socket-error", { message: "Canvas id is required" });
          return;
        }

        try {
          const canvas = await ensureCanvasAccess(
            payload.canvasId,
            user as AuthenticatedUserLike,
          );
          let liveSession = payload.liveSessionId
            ? await prisma.liveSession.findFirst({
                where: {
                  id: payload.liveSessionId,
                  canvasId: payload.canvasId,
                },
              })
            : null;

          if (!liveSession) {
            if (!canHostSocketLiveSession(user.role)) {
              socket.emit("socket-error", {
                message: "Only teachers and admins can create live sessions",
              });
              return;
            }
            liveSession = await prisma.liveSession.create({
              data: {
                canvasId: payload.canvasId,
                organizationId: canvas.organizationId,
                title: payload.title ?? canvas.name,
                createdById: user.userId,
                hostUserId: user.userId,
              },
            });
          }

          await prisma.liveSessionParticipant.upsert({
            where: {
              liveSessionId_userId: {
                liveSessionId: liveSession.id,
                userId: user.userId,
              },
            },
            update: {
              leftAt: null,
            },
            create: {
              liveSessionId: liveSession.id,
              userId: user.userId,
              role: socketParticipantRole(user.role),
            },
          });

          socket.join(`live-session:${liveSession.id}`);
          socket.emit("live-session-joined", {
            liveSessionId: liveSession.id,
            canvasId: payload.canvasId,
          });
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error
                ? error.message
                : "Unable to join live session",
          });
        }
      },
    );

    socket.on("leave-live-session", async (liveSessionId: string) => {
      if (!user || !liveSessionId) {
        return;
      }

      await prisma.liveSessionParticipant.updateMany({
        where: {
          liveSessionId,
          userId: user.userId,
          leftAt: null,
        },
        data: {
          leftAt: new Date(),
        },
      });

      socket.leave(`live-session:${liveSessionId}`);
    });

    socket.on(
      "live-session:join",
      async (payload: { liveSessionId: string }) => {
        if (!user || !payload?.liveSessionId) {
          socket.emit("socket-error", {
            message: "Live session id is required",
          });
          return;
        }

        try {
          const liveSession = await liveSessionService.ensureSessionAccess(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
          );
          await prisma.liveSessionParticipant.upsert({
            where: {
              liveSessionId_userId: {
                liveSessionId: payload.liveSessionId,
                userId: user.userId,
              },
            },
            update: { leftAt: null },
            create: {
              liveSessionId: payload.liveSessionId,
              userId: user.userId,
              role: socketParticipantRole(user.role),
            },
          });
          socket.join(`live-session:${payload.liveSessionId}`);
          socket.emit("live-session:joined", {
            liveSessionId: payload.liveSessionId,
            status: liveSession.status,
          });
          socket
            .to(`live-session:${payload.liveSessionId}`)
            .emit("presence:update", {
              liveSessionId: payload.liveSessionId,
              userId: user.userId,
              email: user.email,
              state: "joined",
            });
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error
                ? error.message
                : "Unable to join live session",
          });
        }
      },
    );

    socket.on(
      "live-session:leave",
      async (payload: { liveSessionId: string }) => {
        if (!user || !payload?.liveSessionId) {
          return;
        }
        await prisma.liveSessionParticipant.updateMany({
          where: {
            liveSessionId: payload.liveSessionId,
            userId: user.userId,
            leftAt: null,
          },
          data: { leftAt: new Date() },
        });
        socket.leave(`live-session:${payload.liveSessionId}`);
        socket
          .to(`live-session:${payload.liveSessionId}`)
          .emit("presence:update", {
            liveSessionId: payload.liveSessionId,
            userId: user.userId,
            email: user.email,
            state: "left",
          });
      },
    );

    socket.on(
      "chat:send",
      async (payload: {
        liveSessionId: string;
        body?: string;
        type?: "TEXT" | "VOICE_NOTE" | "MEDIA" | "SYSTEM";
        attachmentUrl?: string;
        attachmentName?: string;
        metadata?: Record<string, unknown>;
      }) => {
        if (!user || !payload?.liveSessionId) {
          socket.emit("socket-error", {
            message: "Live session id is required",
          });
          return;
        }
        try {
          const message = await liveSessionService.sendMessage(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
            {
              type: payload.type ?? "TEXT",
              body: payload.body,
              attachmentUrl: payload.attachmentUrl,
              attachmentName: payload.attachmentName,
              metadata: payload.metadata,
            },
          );
          io.to(`live-session:${payload.liveSessionId}`).emit(
            "chat:message",
            message,
          );
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error ? error.message : "Unable to send message",
          });
        }
      },
    );

    socket.on(
      "chat:typing",
      (payload: { liveSessionId: string; isTyping: boolean }) => {
        if (!user || !payload?.liveSessionId) {
          return;
        }
        socket.to(`live-session:${payload.liveSessionId}`).emit("chat:typing", {
          liveSessionId: payload.liveSessionId,
          userId: user.userId,
          email: user.email,
          isTyping: payload.isTyping,
        });
      },
    );

    socket.on(
      "board:event",
      async (payload: {
        liveSessionId: string;
        type: string;
        data?: Record<string, unknown>;
      }) => {
        if (!user || !payload?.liveSessionId || !payload.type) {
          return;
        }
        try {
          await liveSessionService.writeEvent(
            payload.liveSessionId,
            user.userId,
            `BOARD_${payload.type}`,
            payload.data,
          );
          socket
            .to(`live-session:${payload.liveSessionId}`)
            .emit("board:activity", {
              liveSessionId: payload.liveSessionId,
              actorUserId: user.userId,
              type: payload.type,
              data: payload.data,
            });
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error
                ? error.message
                : "Unable to sync board event",
          });
        }
      },
    );

    socket.on("call:token", async (payload: { liveSessionId: string }) => {
      if (!user || !payload?.liveSessionId) {
        return;
      }
      try {
        await liveSessionService.ensureSessionAccess(
          user as AuthenticatedUserLike,
          payload.liveSessionId,
        );
        socket.emit("call:token", {
          liveSessionId: payload.liveSessionId,
          ...(await liveSessionService.createCallToken(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
          )),
        });
      } catch (error) {
        socket.emit("socket-error", {
          message:
            error instanceof Error
              ? error.message
              : "Unable to create call token",
        });
      }
    });

    socket.on(
      "screen-share:state",
      async (payload: { liveSessionId: string; isSharing: boolean }) => {
        if (!user || !payload?.liveSessionId) {
          return;
        }
        try {
          await liveSessionService.writeEvent(
            payload.liveSessionId,
            user.userId,
            "SCREEN_SHARE_STATE",
            { isSharing: payload.isSharing },
          );
        } catch {
          // Presence-only screen-share state should still fan out.
        }
        io.to(`live-session:${payload.liveSessionId}`).emit(
          "screen-share:state",
          {
            liveSessionId: payload.liveSessionId,
            userId: user.userId,
            isSharing: payload.isSharing,
          },
        );
      },
    );

    socket.on(
      "hand:raise",
      async (payload: { liveSessionId: string; reason?: string }) => {
        if (!user || !payload?.liveSessionId) {
          socket.emit("socket-error", {
            message: "Live session id is required",
          });
          return;
        }
        try {
          const event = await liveSessionService.raiseHand(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
            { reason: payload.reason },
          );
          io.to(`live-session:${payload.liveSessionId}`).emit(
            "hand:raised",
            event,
          );
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error ? error.message : "Unable to raise hand",
          });
        }
      },
    );

    socket.on(
      "hand:resolve",
      async (payload: {
        liveSessionId: string;
        eventId: string;
        resolution?: "ALLOWED" | "DISMISSED";
      }) => {
        if (!user || !payload?.liveSessionId || !payload.eventId) {
          socket.emit("socket-error", {
            message: "Live session id and event id are required",
          });
          return;
        }
        try {
          const event = await liveSessionService.resolveHand(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
            payload.eventId,
            { resolution: payload.resolution },
          );
          io.to(`live-session:${payload.liveSessionId}`).emit(
            "hand:resolved",
            event,
          );
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error ? error.message : "Unable to resolve hand",
          });
        }
      },
    );

    socket.on(
      "controls:update",
      async (payload: {
        liveSessionId: string;
        controls?: Record<string, unknown>;
      }) => {
        if (!user || !payload?.liveSessionId) {
          socket.emit("socket-error", {
            message: "Live session id is required",
          });
          return;
        }
        try {
          const event = await liveSessionService.updateControls(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
            payload.controls ?? {},
          );
          io.to(`live-session:${payload.liveSessionId}`).emit(
            "controls:update",
            event,
          );
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error
                ? error.message
                : "Unable to update controls",
          });
        }
      },
    );

    socket.on(
      "quiz:launch",
      async (payload: {
        liveSessionId: string;
        question: string;
        options: string[];
        correctIndex?: number;
        durationSeconds?: number;
      }) => {
        if (!user || !payload?.liveSessionId) {
          socket.emit("socket-error", {
            message: "Live session id is required",
          });
          return;
        }
        try {
          const event = await liveSessionService.launchQuiz(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
            {
              question: payload.question,
              options: payload.options,
              correctIndex: payload.correctIndex,
              durationSeconds: payload.durationSeconds,
            },
          );
          io.to(`live-session:${payload.liveSessionId}`).emit(
            "quiz:launched",
            event,
          );
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error ? error.message : "Unable to launch quiz",
          });
        }
      },
    );

    socket.on(
      "quiz:answer",
      async (payload: {
        liveSessionId: string;
        quizEventId: string;
        answer: string;
      }) => {
        if (!user || !payload?.liveSessionId || !payload.quizEventId) {
          socket.emit("socket-error", {
            message: "Live session id and quiz id are required",
          });
          return;
        }
        try {
          const event = await liveSessionService.answerQuiz(
            user as AuthenticatedUserLike,
            payload.liveSessionId,
            payload.quizEventId,
            { answer: payload.answer },
          );
          io.to(`live-session:${payload.liveSessionId}`).emit(
            "quiz:answer",
            event,
          );
        } catch (error) {
          socket.emit("socket-error", {
            message:
              error instanceof Error
                ? error.message
                : "Unable to submit quiz answer",
          });
        }
      },
    );

    socket.on(
      "recording:started",
      async (payload: { liveSessionId: string }) => {
        if (!user || !payload?.liveSessionId) {
          return;
        }
        await liveSessionService.writeEvent(
          payload.liveSessionId,
          user.userId,
          "RECORDING_STARTED",
        );
        io.to(`live-session:${payload.liveSessionId}`).emit(
          "recording:started",
          {
            liveSessionId: payload.liveSessionId,
            userId: user.userId,
          },
        );
      },
    );

    socket.on(
      "recording:stopped",
      async (payload: { liveSessionId: string }) => {
        if (!user || !payload?.liveSessionId) {
          return;
        }
        await liveSessionService.writeEvent(
          payload.liveSessionId,
          user.userId,
          "RECORDING_STOPPED",
        );
        io.to(`live-session:${payload.liveSessionId}`).emit(
          "recording:stopped",
          {
            liveSessionId: payload.liveSessionId,
            userId: user.userId,
          },
        );
      },
    );
  });

  return io;
};
