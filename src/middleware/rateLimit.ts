import type { RequestHandler } from "express";
import { AppError } from "../errors.ts";

export interface RateLimitOptions {
  windowMs: number;    // lebar jendela, default 60_000
  readLimit: number;   // GET, default 60
  writeLimit: number;  // POST/PATCH, default 20
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, readLimit: 60, writeLimit: 20 };

export function rateLimit(opts: RateLimitOptions = DEFAULT_RATE_LIMIT): RequestHandler {
  // state: kunci "ip:read" atau "ip:write" -> { count, resetAt }
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const kind = req.method === "GET" ? "read" : "write";
    const limit = kind === "read" ? opts.readLimit : opts.writeLimit;
    const key = `${req.ip}:${kind}`;
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      // jendela baru: mulai hitung dari 0
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000); // detik
      res.setHeader("Retry-After", String(retryAfter));
      throw new AppError(429, "RATE_LIMITED", `Terlalu banyak request. Coba lagi dalam ${retryAfter} detik.`);
    }
    next();
  };
}
