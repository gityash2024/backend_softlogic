import { NextFunction, Request, Response } from 'express';
import { LiveSessionStatus } from '@prisma/client';
import { ApiResponse } from '@/shared/utils/api-response';
import { liveSessionService } from './live-session.service';

export class LiveSessionController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const liveSessions = await liveSessionService.listSessions(req.user!, {
        status: req.query.status as LiveSessionStatus | undefined,
      });
      ApiResponse.success(res, liveSessions);
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const liveSession = await liveSessionService.createSession(req.user!, req.body);
      ApiResponse.created(res, liveSession, 'Live session created');
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const liveSession = await liveSessionService.getSession(req.user!, req.params.id);
      ApiResponse.success(res, liveSession);
    } catch (error) {
      next(error);
    }
  }

  async start(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const liveSession = await liveSessionService.startSession(req.user!, req.params.id);
      ApiResponse.success(res, liveSession, 'Live session started');
    } catch (error) {
      next(error);
    }
  }

  async end(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const liveSession = await liveSessionService.endSession(req.user!, req.params.id);
      ApiResponse.success(res, liveSession, 'Live session ended');
    } catch (error) {
      next(error);
    }
  }

  async invite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const invite = await liveSessionService.inviteStudent(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.created(res, invite, 'Live session invite sent');
    } catch (error) {
      next(error);
    }
  }

  async generateJoinCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const joinCode = await liveSessionService.generateSessionJoinCode(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.success(res, joinCode, 'Live session join code generated');
    } catch (error) {
      next(error);
    }
  }

  async getJoinCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const joinCode = await liveSessionService.getSessionJoinCode(
        req.user!,
        req.params.id,
      );
      ApiResponse.success(res, joinCode);
    } catch (error) {
      next(error);
    }
  }

  async verifyJoinCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await liveSessionService.verifyJoinCode(req.body.code);
      ApiResponse.success(res, result, 'Session code verified');
    } catch (error) {
      next(error);
    }
  }

  async joinByCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await liveSessionService.joinByCode(req.user!, req.body.code);
      ApiResponse.success(res, result, 'Joined live session');
    } catch (error) {
      next(error);
    }
  }

  async listMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const messages = await liveSessionService.listMessages(req.user!, req.params.id);
      ApiResponse.success(res, messages);
    } catch (error) {
      next(error);
    }
  }

  async createMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const message = await liveSessionService.sendMessage(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.created(res, message, 'Message sent');
    } catch (error) {
      next(error);
    }
  }

  async createMedia(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const media = await liveSessionService.createMediaAsset(
        req.user!,
        req.params.id,
        req.body,
        req.file,
      );
      ApiResponse.created(res, media, 'Media uploaded');
    } catch (error) {
      next(error);
    }
  }

  async listMedia(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const media = await liveSessionService.listMediaAssets(req.user!, req.params.id);
      ApiResponse.success(res, media);
    } catch (error) {
      next(error);
    }
  }

  async createRecording(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recording = await liveSessionService.createRecording(
        req.user!,
        req.params.id,
        req.body,
        req.file,
      );
      ApiResponse.created(res, recording, 'Recording saved');
    } catch (error) {
      next(error);
    }
  }

  async listRecordings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const recordings = await liveSessionService.listRecordings(
        req.user!,
        req.params.id,
      );
      ApiResponse.success(res, recordings);
    } catch (error) {
      next(error);
    }
  }

  async listEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const events = await liveSessionService.listEvents(req.user!, req.params.id);
      ApiResponse.success(res, events);
    } catch (error) {
      next(error);
    }
  }

  async raiseHand(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await liveSessionService.raiseHand(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.created(res, event, 'Hand raised');
    } catch (error) {
      next(error);
    }
  }

  async resolveHand(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await liveSessionService.resolveHand(
        req.user!,
        req.params.id,
        req.params.eventId,
        req.body,
      );
      ApiResponse.success(res, event, 'Hand resolved');
    } catch (error) {
      next(error);
    }
  }

  async updateControls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await liveSessionService.updateControls(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.success(res, event, 'Controls updated');
    } catch (error) {
      next(error);
    }
  }

  async launchQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await liveSessionService.launchQuiz(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.created(res, event, 'Quiz launched');
    } catch (error) {
      next(error);
    }
  }

  async answerQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await liveSessionService.answerQuiz(
        req.user!,
        req.params.id,
        req.params.quizEventId,
        req.body,
      );
      ApiResponse.created(res, event, 'Quiz answer saved');
    } catch (error) {
      next(error);
    }
  }

  async createShareUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const share = await liveSessionService.createShareUrl(
        req.user!,
        req.params.id,
        req.body,
      );
      ApiResponse.success(res, share, 'Share URL generated');
    } catch (error) {
      next(error);
    }
  }

  async createCallToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = await liveSessionService.createCallToken(req.user!, req.params.id);
      ApiResponse.success(res, token, 'Call token generated');
    } catch (error) {
      next(error);
    }
  }
}

export const liveSessionController = new LiveSessionController();
