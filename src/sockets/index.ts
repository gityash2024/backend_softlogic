import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from '@/shared/utils/jwt';
import { ensureCanvasAccess, AuthenticatedUserLike } from '@/shared/utils/access-control';
import { prisma } from '@/config';

interface SocketUserContext extends AuthenticatedUserLike {
  email: string;
}

const resolveSocketToken = (authorization?: string, authToken?: unknown): string | null => {
  if (typeof authToken === 'string' && authToken.trim().length > 0) {
    return authToken.trim();
  }

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim();
};

export const setupSockets = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
    try {
      const token = resolveSocketToken(
        socket.handshake.headers.authorization,
        socket.handshake.auth.token,
      );

      if (!token) {
        return next(new Error('Authentication token is required'));
      }

      socket.data.user = verifyAccessToken(token);
      return next();
    } catch {
      return next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as SocketUserContext | undefined;
    console.log(`Socket connected: ${socket.id} (${user?.email ?? 'unknown'})`);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });

    socket.on('join-canvas', async (canvasId: string) => {
      if (!user || !canvasId) {
        socket.emit('socket-error', { message: 'Canvas id is required' });
        return;
      }

      try {
        const canvas = await ensureCanvasAccess(canvasId, user as AuthenticatedUserLike);
        socket.join(`canvas:${canvasId}`);
        socket.emit('canvas-joined', {
          canvasId,
          organizationId: canvas.organizationId,
        });
      } catch (error) {
        socket.emit('socket-error', {
          message: error instanceof Error ? error.message : 'Unable to join canvas',
        });
      }
    });

    socket.on('leave-canvas', (canvasId: string) => {
      socket.leave(`canvas:${canvasId}`);
    });

    socket.on(
      'join-live-session',
      async (payload: { canvasId: string; liveSessionId?: string; title?: string }) => {
        if (!user || !payload?.canvasId) {
          socket.emit('socket-error', { message: 'Canvas id is required' });
          return;
        }

        try {
          const canvas = await ensureCanvasAccess(payload.canvasId, user as AuthenticatedUserLike);
          let liveSession = payload.liveSessionId
            ? await prisma.liveSession.findFirst({
                where: {
                  id: payload.liveSessionId,
                  canvasId: payload.canvasId,
                },
              })
            : null;

          if (!liveSession) {
            liveSession = await prisma.liveSession.create({
              data: {
                canvasId: payload.canvasId,
                organizationId: canvas.organizationId,
                title: payload.title ?? canvas.name,
                createdById: user.userId,
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
            },
          });

          socket.join(`live-session:${liveSession.id}`);
          socket.emit('live-session-joined', {
            liveSessionId: liveSession.id,
            canvasId: payload.canvasId,
          });
        } catch (error) {
          socket.emit('socket-error', {
            message:
              error instanceof Error ? error.message : 'Unable to join live session',
          });
        }
      },
    );

    socket.on('leave-live-session', async (liveSessionId: string) => {
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
  });

  return io;
};
