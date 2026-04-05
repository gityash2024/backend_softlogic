import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { corsConfig, swaggerSpec } from './config';
import { errorMiddleware } from './shared/middleware/error.middleware';
import { globalRateLimiter } from './shared/middleware/rate-limit.middleware';
import { requestLogger } from './shared/middleware/logger.middleware';
import swaggerUi from 'swagger-ui-express';

// Route imports
import { authRoutes } from './modules/auth/auth.routes';
import { userRoutes } from './modules/users/user.routes';
import { canvasRoutes } from './modules/canvas/canvas.routes';
import { slidesRoutes } from './modules/slides/slides.routes';
import { exportRoutes } from './modules/export/export.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { filterRoutes } from './modules/filter/filter.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import {
  chatRoutes,
  mediaRoutes,
  integrationsRoutes,
  assessmentsRoutes,
  aiRoutes,
  simulationsRoutes,
  marketplaceRoutes,
} from './modules/stubs';

export const createApp = (): express.Application => {
  const app = express();

  // ─── Security ─────────────────────────────
  app.use(helmet());
  app.use(cors(corsConfig));

  // ─── Body Parsing ─────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ─── Logging ──────────────────────────────
  app.use(requestLogger);

  // ─── Rate Limiting ────────────────────────
  app.use(globalRateLimiter);

  // ─── API Documentation ────────────────────
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Softlogic Whiteboard API',
  }));

  // ─── Health Check ─────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Phase 1 Routes ───────────────────────
  const apiPrefix = '/api/v1';

  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/users`, userRoutes);
  app.use(`${apiPrefix}/canvas`, canvasRoutes);
  app.use(`${apiPrefix}/canvas/:id/slides`, slidesRoutes);
  app.use(`${apiPrefix}/export`, exportRoutes);
  app.use(`${apiPrefix}/users/me/settings`, settingsRoutes);
  app.use(`${apiPrefix}/filter`, filterRoutes);
  app.use(`${apiPrefix}/admin`, adminRoutes);

  // ─── Phase 2–6 Stubs ─────────────────────
  app.use(`${apiPrefix}/chat`, chatRoutes);
  app.use(`${apiPrefix}/media`, mediaRoutes);
  app.use(`${apiPrefix}/integrations`, integrationsRoutes);
  app.use(`${apiPrefix}/assessments`, assessmentsRoutes);
  app.use(`${apiPrefix}/ai`, aiRoutes);
  app.use(`${apiPrefix}/simulations`, simulationsRoutes);
  app.use(`${apiPrefix}/marketplace`, marketplaceRoutes);

  // ─── 404 Handler ──────────────────────────
  app.use('*', (_req, res) => {
    res.status(404).json({
      success: false,
      data: null,
      message: 'Resource not found',
    });
  });

  // ─── Error Handler ────────────────────────
  app.use(errorMiddleware);

  return app;
};
