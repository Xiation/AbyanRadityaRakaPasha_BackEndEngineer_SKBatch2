// Request id + one structured log line per request.
//  - Every response carries X-Request-Id. A client-supplied id is reused only if it looks safe
//    (so it cannot inject newlines or huge strings into logs); otherwise a UUID is generated.
//  - The log line has method, path (WITHOUT the query string), status and duration. It never logs
//    request bodies, headers, IPs or query strings, because those can contain personal data.
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export type LogSink = (line: string) => void;

export function requestLogger(sink?: LogSink): RequestHandler {
  return (req, res, next) => {
    const supplied = req.get("x-request-id");
    const id = supplied && SAFE_ID.test(supplied) ? supplied : randomUUID();
    res.locals.requestId = id;
    res.setHeader("X-Request-Id", id);

    if (sink) {
      const start = process.hrtime.bigint();
      res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        sink(
          JSON.stringify({
            ts: new Date().toISOString(),
            id,
            method: req.method,
            path: req.originalUrl.split("?")[0],
            status: res.statusCode,
            ms: Math.round(ms * 10) / 10,
          }),
        );
      });
    }
    next();
  };
}
