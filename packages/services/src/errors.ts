export interface FieldError {
  field: string;
  message: string;
}

/** Typed application error. `message` is always safe to show to the user. */
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public fields?: FieldError[],
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found`);
export const forbidden = (message = 'You do not have permission to do that') => new AppError('FORBIDDEN', 403, message);
export const conflict = (code: string, message: string, extra?: Record<string, unknown>) => new AppError(code, 409, message, undefined, extra);
export const invalid = (message: string, fields?: FieldError[], code = 'VALIDATION_FAILED') => new AppError(code, 422, message, fields);
export const unavailable = (code: string, message: string) => new AppError(code, 503, message);
