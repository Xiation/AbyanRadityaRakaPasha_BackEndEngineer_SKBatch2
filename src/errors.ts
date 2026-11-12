// Every expected failure is thrown as an AppError and turned into the single error shape
// { error: { code, message, details } } by middleware/errorHandler.ts.
// Codes and statuses: see docs/PRD.md section 9.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}
