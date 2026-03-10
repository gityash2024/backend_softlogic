import http from 'http';
import { createApp } from './app';
import { env, connectDatabase } from './config';
import { setupSockets } from './sockets';
import { logger } from './shared/middleware/logger.middleware';

const start = async (): Promise<void> => {
  try {
    // Connect to database
    await connectDatabase();

    // Create Express app
    const app = createApp();

    // Create HTTP server
    const server = http.createServer(app);

    // Setup WebSockets
    setupSockets(server);

    // Start server
    server.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT}`);
      logger.info(`📚 API Docs: http://localhost:${env.PORT}/api/docs`);
      logger.info(`🏥 Health: http://localhost:${env.PORT}/api/health`);
      logger.info(`🌍 Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
