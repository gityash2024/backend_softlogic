import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '@/shared/errors/ValidationError';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      throw ValidationError.fromZodError(result.error);
    }

    // Replace with validated/parsed data
    req[source] = result.data;
    next();
  };
};
