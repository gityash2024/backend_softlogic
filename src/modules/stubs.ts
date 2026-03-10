import { Router } from 'express';

const createStubRouter = (phase: number, moduleName: string): Router => {
  const router = Router();
  router.all('*', (_req, res) => {
    res.status(501).json({
      success: false,
      data: null,
      message: `${moduleName} module is coming in Phase ${phase}`,
      status: 'coming_soon',
      phase,
    });
  });
  return router;
};

// Phase 2 stubs
export const chatRoutes = createStubRouter(2, 'Chat');
export const mediaRoutes = createStubRouter(2, 'Media');
export const integrationsRoutes = createStubRouter(2, 'Integrations');

// Phase 3 stubs
export const assessmentsRoutes = createStubRouter(3, 'Assessments');

// Phase 4 stubs
export const aiRoutes = createStubRouter(4, 'AI Tools');

// Phase 5 stubs
export const simulationsRoutes = createStubRouter(5, 'Simulations');

// Phase 6 stubs
export const marketplaceRoutes = createStubRouter(6, 'Marketplace');
