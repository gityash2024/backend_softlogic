import { Request, Response, NextFunction } from 'express';
import Filter from 'bad-words';

import { env } from '@/config';
import { normalizeCustomProfanityWords } from '@/modules/settings/settings.service';
import { ApiResponse } from '@/shared/utils/api-response';

export class FilterController {
  async check(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const text = typeof req.body.text === 'string' ? req.body.text : '';
      const customWords = normalizeCustomProfanityWords(req.body.customWords);

      if (!env.PROFANITY_ENABLED) {
        ApiResponse.success(res, { clean: true, filtered: text });
        return;
      }

      const filter = new Filter();
      if (customWords.length > 0) {
        filter.addWords(...customWords);
      }

      const clean = !filter.isProfane(text);
      const filtered = clean ? text : filter.clean(text);

      ApiResponse.success(res, { clean, filtered });
    } catch (error) {
      next(error);
    }
  }
}

export const filterController = new FilterController();
