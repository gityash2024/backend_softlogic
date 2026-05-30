import { NextFunction, Request, Response } from 'express';

import { ApiResponse } from '@/shared/utils/api-response';

import { supportService } from './support.service';

const sendPaginated = <T>(
  res: Response,
  result: {
    items: T[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    filters: Record<string, unknown>;
  },
) =>
  ApiResponse.success(res, result.items, 'Success', 200, {
    total: result.total,
    page: result.page,
    perPage: result.perPage,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    hasPrevPage: result.hasPrevPage,
    filters: result.filters,
  });

export class SupportController {
  async listThreads(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await supportService.listThreads(req.user!, req.query as never);
      sendPaginated(res, result);
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await supportService.getUnreadCount(req.user!));
    } catch (error) {
      next(error);
    }
  }

  async getThread(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, await supportService.getThread(req.user!, req.params.id));
    } catch (error) {
      next(error);
    }
  }

  async createThread(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const thread = await supportService.createThread(req.user!, req.body);
      ApiResponse.created(res, thread, 'Support thread created');
    } catch (error) {
      next(error);
    }
  }

  async addMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const thread = await supportService.addMessage(req.user!, req.params.id, req.body.body);
      ApiResponse.created(res, thread, 'Reply sent');
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await supportService.updateStatus(req.user!, req.params.id, req.body),
        'Status updated',
      );
    } catch (error) {
      next(error);
    }
  }

  async setPriority(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await supportService.setPriority(req.user!, req.params.id, req.body),
        'Priority updated',
      );
    } catch (error) {
      next(error);
    }
  }

  async applyAction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(
        res,
        await supportService.applyAction(req.user!, req.params.id, req.body),
        'Action applied',
      );
    } catch (error) {
      next(error);
    }
  }
}

export const supportController = new SupportController();
