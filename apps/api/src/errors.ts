export class AppError extends Error {
  constructor(message: string, public statusCode = 400, public code = 'BAD_REQUEST') {
    super(message);
    this.name = 'AppError';
  }
}
