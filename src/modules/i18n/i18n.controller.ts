import { Request, Response, NextFunction } from 'express';

import { ApiResponse } from '@/shared/utils/api-response';

import { i18nService } from './i18n.service';

export class I18nController {
  async getLanguages(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      ApiResponse.success(res, i18nService.listLanguages(), 'Supported languages');
    } catch (error) {
      next(error);
    }
  }

  async translate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await i18nService.translatePortalTexts(req.body);
      ApiResponse.success(res, result, result.providerAvailable ? 'Translated' : 'Translation fallback');
    } catch (error) {
      next(error);
    }
  }
}

export const i18nController = new I18nController();
