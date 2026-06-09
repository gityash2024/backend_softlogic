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

  async proxyGemini(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await aiService.proxyGeminiGenerate(req.user!, req.body), 'AI response generated');
    } catch (error) {
      next(error);
    }
  }
}

export const aiController = new AiController();
