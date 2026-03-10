import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

export const setupSockets = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: '*', // Configure properly in production
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });

    // Phase 2+ handlers will be added here
    socket.on('join-canvas', (canvasId: string) => {
      socket.join(`canvas:${canvasId}`);
      console.log(`📋 Socket ${socket.id} joined canvas: ${canvasId}`);
    });

    socket.on('leave-canvas', (canvasId: string) => {
      socket.leave(`canvas:${canvasId}`);
    });
  });

  return io;
};
