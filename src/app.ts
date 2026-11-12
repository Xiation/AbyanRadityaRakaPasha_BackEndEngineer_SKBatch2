import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { applicantsRouter } from "./applicants/applicants.routes.ts";
import { requireRole } from "./middleware/role.ts";
import { rateLimit, type RateLimitOptions } from "./middleware/rateLimit.ts";
import { requestLogger, type LogSink } from "./middleware/requestLogger.ts";
import { noStore, requireJson } from "./middleware/httpGuards.ts";
import { mountDocs } from "./docs.ts";

export interface AppOptions {
  rateLimit?: RateLimitOptions; // tests inject their own limits
  logger?: LogSink; // one JSON line per request; omitted = no logging (quiet tests)
}

// Factory so tests can pass an in-memory DB.
export function createApp(db: DatabaseSync, options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger(options.logger)); // first, so even rejected requests get an id and a log line
  app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
  app.use(express.json({ limit: "10kb" })); // oversized body -> entity.too.large -> 413

  // Liveness + a cheap database check: 503 when the DB cannot answer, so an orchestrator can react.
  app.get("/health", (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  // Swagger UI is public: mounted outside /v1, so it needs no X-Role and is not rate limited.
  mountDocs(app);

  // Versioned API. Order: no-store header, rate limit (reject spam cheaply), role, media type, then the router.
  app.use("/v1/applicants", noStore, rateLimit(options.rateLimit), requireRole, requireJson, applicantsRouter(db));

  // Order matters: these two go AFTER every route.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
