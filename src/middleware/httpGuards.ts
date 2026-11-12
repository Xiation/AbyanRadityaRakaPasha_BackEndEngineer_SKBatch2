// Small HTTP-semantics guards used on the API routes.
import type { RequestHandler } from "express";
import { AppError } from "../errors.ts";

// Responses contain personal data (names, emails, phone numbers): tell browsers and proxies not to store them.
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

// 415 when a request has a body but it is not declared as JSON (the API only speaks JSON).
export const requireJson: RequestHandler = (req, _res, next) => {
  const hasBody = req.get("transfer-encoding") !== undefined || Number(req.get("content-length") ?? 0) > 0;
  if (hasBody && !req.is("application/json")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type harus application/json.");
  }
  next();
};

// 405 for a known path used with a method it does not support (instead of a misleading 404).
// Per RFC 9110 the response must list the supported methods in the Allow header.
// OPTIONS is answered here too, because this handler is registered with .all().
export function methodNotAllowed(supported: string[]): RequestHandler {
  const allow = [...new Set([...supported, ...(supported.includes("GET") ? ["HEAD"] : []), "OPTIONS"])].join(", ");
  return (req, res) => {
    res.setHeader("Allow", allow);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    throw new AppError(405, "METHOD_NOT_ALLOWED", `Method ${req.method} tidak didukung di path ini. Gunakan: ${allow}.`);
  };
}
