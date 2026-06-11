import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { aiService } from './ai.service';

class AiController {
  async adminOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.getOverview(req.user!));
    } catch (error) {
      next(error);
    }
  }

  async adminUpdateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.updateConfig(req.user!, req.body), 'AI configuration saved');
    } catch (error) {
      next(error);
    }
  }

  async adminTestConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.testConfig(req.user!, req.body), 'AI configuration tested');
    } catch (error) {
      next(error);
    }
  }

  async adminUpdatePricing(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.updatePricing(req.user!, req.body.pricing), 'AI pricing saved');
    } catch (error) {
      next(error);
    }
  }

  async adminUpdateGoogleBilling(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await aiService.updateGoogleBillingConfig(req.user!, req.body),
        'Google billing verification saved',
      );
    } catch (error) {
      next(error);
    }
  }

  async adminSyncGoogleBilling(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await aiService.syncGoogleBilling(req.user!),
        'Google billing verification synced',
      );
    } catch (error) {
      next(error);
    }
  }

  async adminTopUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(res, await aiService.topUp(req.user!, req.body), 'AI credits added');
    } catch (error) {
      next(error);
    }
  }

  async adminAllocate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(res, await aiService.allocate(req.user!, req.body), 'AI credits allocated');
    } catch (error) {
      next(error);
    }
  }

  async adminSetAllocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.setAllocation(req.user!, req.body), 'AI credit allocation saved');
    } catch (error) {
      next(error);
    }
  }

  async reserveFeatureAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.created(
        res,
        await aiService.reserveFeatureAttempt(req.user!, req.body),
        'AI feature attempt reserved',
      );
    } catch (error) {
      next(error);
    }
  }

  async commitFeatureAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await aiService.commitFeatureAttempt(req.user!, req.body),
        'AI feature attempt committed',
      );
    } catch (error) {
      next(error);
    }
  }

  async failFeatureAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await aiService.failFeatureAttempt(req.user!, req.body),
        'AI feature attempt released',
      );
    } catch (error) {
      next(error);
    }
  }

  async proxyGemini(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.proxyGeminiGenerate(req.user!, req.body), 'AI response generated');
    } catch (error) {
      next(error);
    }
  }
}

export const aiController = new AiController();
