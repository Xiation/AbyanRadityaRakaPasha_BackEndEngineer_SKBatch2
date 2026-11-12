// Every failure leaves the API in one shape: { error: { code, message, details } }.
// Express 5 forwards errors thrown in sync and async handlers to errorHandler automatically.
import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { AppError } from "../errors.ts";

// One place that knows the error body shape.
function sendError(res: Response, status: number, code: string, message: string, details: unknown[] = []) {
  res.status(status).json({ error: { code, message, details } });
}

// Mounted AFTER all routes: an unknown route becomes 404 in our format.
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} tidak ditemukan.`));
};

// Error middleware must declare 4 parameters, otherwise Express does not treat it as one.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const requestId = res.locals.requestId ?? "-";
  // 1. errors we throw on purpose (validation, duplicate, illegal transition, 404, 403, 429)
  if (err instanceof AppError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }

  // 2. predictable errors from express.json(): identified by err.type, not instanceof
  if (err?.type === "entity.parse.failed") {
    return sendError(res, 400, "INVALID_JSON", "Body bukan JSON yang valid.");
  }
  if (err?.type === "entity.too.large") {
    return sendError(res, 413, "PAYLOAD_TOO_LARGE", "Body melebihi 10 KB.");
  }

  // 3. anything else is a bug: log details server-side, never leak them to the client
  console.error(`[${requestId}]`, err);
  return sendError(res, 500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
};
