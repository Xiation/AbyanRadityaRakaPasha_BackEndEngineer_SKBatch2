// Simulated role, NOT authentication: reads the X-Role header ("applicant" | "recruiter"), rejects anything
// else with 400 INVALID_ROLE, and exposes the role to handlers as res.locals.role.
// Mounted only on /applicants (not /health or /docs). See docs/design-decisions.md section 4.
import type { RequestHandler } from "express";
import { AppError } from "../errors.ts";
import { ROLES, type Role } from "../applicants/stages.ts";

export const requireRole: RequestHandler = (req, res, next) => {
  const header = req.header("x-role");
  if (!header || !ROLES.includes(header as Role)) {
    throw new AppError(400, "INVALID_ROLE", "Header X-Role wajib berisi applicant atau recruiter.");
  }

  res.locals.role = header as Role;
  next(); // WAJIB: tanpa ini request menggantung
};
