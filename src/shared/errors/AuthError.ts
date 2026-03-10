import { AppError } from './AppError';

export class AuthError extends AppError {
  constructor(message = 'Authentication failed', statusCode = 401) {
    super(message, statusCode);
    Object.setPrototypeOf(this, AuthError.prototype);
  }

  static invalidCredentials(): AuthError {
    return new AuthError('Invalid credentials', 401);
  }

  static tokenExpired(): AuthError {
    return new AuthError('Token has expired', 401);
  }

  static tokenInvalid(): AuthError {
    return new AuthError('Invalid token', 401);
  }

  static unauthorized(): AuthError {
    return new AuthError('You are not authorized to access this resource', 403);
  }

  static otpExpired(): AuthError {
    return new AuthError('OTP has expired', 400);
  }

  static otpInvalid(): AuthError {
    return new AuthError('Invalid OTP', 400);
  }

  static otpMaxAttempts(): AuthError {
    return new AuthError('Maximum OTP attempts exceeded. Please request a new OTP.', 429);
  }

  static rateLimited(): AuthError {
    return new AuthError('Too many requests. Please try again later.', 429);
  }
}
