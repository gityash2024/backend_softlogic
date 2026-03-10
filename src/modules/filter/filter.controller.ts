import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@/shared/utils/api-response';
import { env } from '@/config';

// Simple profanity filter — using basic implementation for now
// TODO: Replace with 'bad-words' package for comprehensive filtering
const PROFANITY_LIST = ['badword1', 'badword2']; // Placeholder

export class FilterController {
  async check(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { text } = req.body;

      if (!env.PROFANITY_ENABLED) {
        ApiResponse.success(res, { clean: true, filtered: text });
        return;
      }

      let filtered = text;
      let clean = true;

      for (const word of PROFANITY_LIST) {
        const regex = new RegExp(word, 'gi');
        if (regex.test(filtered)) {
          clean = false;
          filtered = filtered.replace(regex, '*'.repeat(word.length));
        }
      }

      ApiResponse.success(res, { clean, filtered });
    } catch (error) { next(error); }
  }
}

export const filterController = new FilterController();
