import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { corsConfig, swaggerSpec } from './config';
import { createVersionPayload } from './config/version';
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
import { licensingRoutes } from './modules/licensing/licensing.routes';
import { classroomRoutes } from './modules/classroom/classroom.routes';
import { liveSessionRoutes } from './modules/live-sessions/live-session.routes';
import { integrationsRoutes } from './modules/integrations/integrations.routes';
import { integrationsController } from './modules/integrations/integrations.controller';
import { mediaRoutes } from './modules/media/media.routes';
import { i18nRoutes } from './modules/i18n/i18n.routes';
import { feedbackRoutes } from './modules/feedback/feedback.routes';
import { organizationsRoutes } from './modules/organizations/organizations.routes';
import { supportRoutes } from './modules/support/support.routes';
import { aiRoutes } from './modules/ai/ai.routes';
import {
  chatRoutes,
  assessmentsRoutes,
  simulationsRoutes,
  marketplaceRoutes,
} from './modules/stubs';

export const createApp = (): express.Application => {
  const app = express();
  const apiPrefix = '/api/v1';

  // Both deployments terminate TLS in a local Nginx reverse proxy.
  // Trust only loopback proxies so rate limiting uses the real client IP.
  app.set('trust proxy', 'loopback');

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
  app.get('/api/docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });

  app.get(`${apiPrefix}/docs.json`, (_req, res) => {
    res.json(swaggerSpec);
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Softlogic Whiteboard API',
  }));

  app.use(
    '/storage',
    express.static(path.resolve(process.cwd(), 'storage'), {
      dotfiles: 'deny',
      fallthrough: false,
      immutable: true,
      maxAge: '1d',
    }),
  );

  // ─── Health Check ─────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/version', (_req, res) => {
    res.json({
      success: true,
      data: createVersionPayload(),
      message: 'Version metadata',
    });
  });

  app.get(`${apiPrefix}/version`, (_req, res) => {
    res.json({
      success: true,
      data: createVersionPayload('v1'),
      message: 'Version metadata',
    });
  });

  app.get('/oauth/dropbox/callback', (req, res, next) => {
    void integrationsController.dropboxCallback(req, res, next);
  });
  app.get('/oauth/google-drive/callback', (req, res, next) => {
    void integrationsController.googleDriveCallback(req, res, next);
  });
  app.get('/oauth/onedrive/callback', (req, res, next) => {
    void integrationsController.oneDriveCallback(req, res, next);
  });

  // ─── Phase 1 Routes ───────────────────────
  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/users`, userRoutes);
  app.use(`${apiPrefix}/canvas`, canvasRoutes);
  app.use(`${apiPrefix}/canvas/:id/slides`, slidesRoutes);
  app.use(`${apiPrefix}/export`, exportRoutes);
  app.use(`${apiPrefix}/users/me/settings`, settingsRoutes);
  app.use(`${apiPrefix}/filter`, filterRoutes);
  app.use(`${apiPrefix}/admin`, adminRoutes);
  app.use(`${apiPrefix}/license`, licensingRoutes);
  app.use(`${apiPrefix}/organizations`, organizationsRoutes);
  app.use(`${apiPrefix}/support`, supportRoutes);
  app.use(`${apiPrefix}/i18n`, i18nRoutes);
  app.use(`${apiPrefix}/feedback`, feedbackRoutes);
  app.use(`${apiPrefix}/classroom`, classroomRoutes);
  app.use(`${apiPrefix}/live-sessions`, liveSessionRoutes);

  // ─── Phase 2–6 Stubs ─────────────────────
  app.use(`${apiPrefix}/chat`, chatRoutes);
  app.use(`${apiPrefix}/media`, mediaRoutes);
  app.use(`${apiPrefix}/integrations`, integrationsRoutes);
  app.use(`${apiPrefix}/assessments`, assessmentsRoutes);
  app.use(`${apiPrefix}/ai`, aiRoutes);
  app.use(`${apiPrefix}/simulations`, simulationsRoutes);
  app.use(`${apiPrefix}/marketplace`, marketplaceRoutes);

  const adminRoot = path.resolve(process.cwd(), 'public', 'admin');
  app.use(
    '/admin',
    express.static(adminRoot, {
      dotfiles: 'deny',
      fallthrough: true,
      immutable: true,
      maxAge: '1d',
    }),
  );
  app.get(['/admin', '/admin/*'], (_req, res) => {
    res.sendFile(path.join(adminRoot, 'index.html'));
  });

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
