import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { applicantsRouter } from "./applicants/applicants.routes.ts";
import { requireRole } from "./middleware/role.ts";
import { rateLimit, type RateLimitOptions } from "./middleware/rateLimit.ts";
import { mountDocs } from "./docs.ts";

// Factory so tests can pass an in-memory DB.
export function createApp(db: DatabaseSync, options: { rateLimit?: RateLimitOptions } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
  app.use(express.json({ limit: "10kb" })); // oversized body -> entity.too.large -> 413

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Swagger UI is public: mounted outside /applicants, so it needs no X-Role and is not rate limited.
  mountDocs(app);

  // Per route group: rate limit first (so spam is rejected cheaply), then role check, then the router.
  app.use("/applicants", rateLimit(options.rateLimit), requireRole, applicantsRouter(db));

  // Order matters: these two go AFTER every route.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
