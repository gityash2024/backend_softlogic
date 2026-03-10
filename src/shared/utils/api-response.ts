import { Response } from 'express';

interface ApiResponseOptions<T> {
  success: boolean;
  data?: T;
  message: string;
  errors?: Record<string, string[]> | null;
  meta?: Record<string, unknown> | null;
}

export class ApiResponse {
  static success<T>(res: Response, data: T, message = 'Success', statusCode = 200, meta?: Record<string, unknown>): Response {
    return res.status(statusCode).json({
      success: true,
      data,
      message,
      meta: meta || null,
    });
  }

  static created<T>(res: Response, data: T, message = 'Created successfully'): Response {
    return ApiResponse.success(res, data, message, 201);
  }

  static noContent(res: Response, message = 'Deleted successfully'): Response {
    return res.status(204).send();
  }

  static error(
    res: Response,
    message: string,
    statusCode = 500,
    errors?: Record<string, string[]>
  ): Response {
    return res.status(statusCode).json({
      success: false,
      data: null,
      message,
      errors: errors || null,
    });
  }

  static paginated<T>(
    res: Response,
    data: T[],
    total: number,
    page: number,
    perPage: number,
    message = 'Success'
  ): Response {
    const totalPages = Math.ceil(total / perPage);
    return res.status(200).json({
      success: true,
      data,
      message,
      meta: {
        total,
        page,
        perPage,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  }
}
