import { AppError } from './AppError';
import { ZodError } from 'zod';

export class ValidationError extends AppError {
  public readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>) {
    super('Validation failed', 400);
    this.errors = errors;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  static fromZodError(zodError: ZodError): ValidationError {
    const errors: Record<string, string[]> = {};
    for (const issue of zodError.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(issue.message);
    }
    return new ValidationError(errors);
  }
}
