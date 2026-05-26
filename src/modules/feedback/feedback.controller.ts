import { Request, Response, NextFunction } from 'express';

import { ApiResponse } from '@/shared/utils/api-response';

import { feedbackService } from './feedback.service';
import type {
  AddCommentInput,
  CreateThreadInput,
  EditCommentInput,
  ListThreadsQuery,
  UpdateThreadStatusInput,
} from './feedback.validator';

export class FeedbackController {
  async listThreads(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const threads = await feedbackService.listThreads(
        req.query as unknown as ListThreadsQuery,
      );
      ApiResponse.success(res, threads);
    } catch (error) {
      next(error);
    }
  }

  async createThread(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const thread = await feedbackService.createThread(req.body as CreateThreadInput);
      ApiResponse.created(res, thread, 'Thread created');
    } catch (error) {
      next(error);
    }
  }

  async updateThreadStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const thread = await feedbackService.updateThreadStatus(
        req.params.id,
        req.body as UpdateThreadStatusInput,
      );
      ApiResponse.success(res, thread, 'Thread updated');
    } catch (error) {
      next(error);
    }
  }

  async addComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const comment = await feedbackService.addComment(
        req.params.id,
        req.body as AddCommentInput,
      );
      ApiResponse.created(res, comment, 'Comment added');
    } catch (error) {
      next(error);
    }
  }

  async editComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const comment = await feedbackService.editComment(
        req.params.id,
        req.body as EditCommentInput,
      );
      ApiResponse.success(res, comment, 'Comment updated');
    } catch (error) {
      next(error);
    }
  }

  async deleteComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await feedbackService.deleteComment(
        req.params.id,
        String(req.query.authorClientId ?? ''),
      );
      ApiResponse.success(res, result, 'Comment deleted');
    } catch (error) {
      next(error);
    }
  }
}

export const feedbackController = new FeedbackController();
