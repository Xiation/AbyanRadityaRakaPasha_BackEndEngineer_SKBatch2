import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createApplicant, updateStage, getApplicant, listApplicants } from "./applicants.service.ts";
import { parseOrThrow } from "../helper/validate.ts";
import { createApplicantSchema, idParamSchema, updateStageSchema, listQuerySchema } from "./applicants.schemas.ts";
import type { Role } from "./stages.ts";

// HTTP only: parse + validate input, call the service, send the response.
// Routes (contract: docs/openapi.yaml):
//   POST  /           create
//   GET   /           list       (recruiter only)
//   GET   /:id        detail
//   PATCH /:id/stage  update stage
export function applicantsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    res.json(listApplicants(db, query, res.locals.role as Role));
  });

  router.post("/", (req, res) => {
    const input = parseOrThrow(createApplicantSchema, req.body);
    const role = res.locals.role as Role;
    const id = createApplicant(db, input, role);
    res.status(201).location(`/applicants/${id}`).json(getApplicant(db, id, role));
  });

  router.patch("/:id/stage", (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const body = parseOrThrow(updateStageSchema, req.body);
    const role = res.locals.role as Role;
    updateStage(db, id, body.to_stage, body.reason ?? null, body.notes ?? null, role);
    res.status(200).json(getApplicant(db, id, role));
  });

  router.get("/:id", (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    res.json(getApplicant(db, id, res.locals.role as Role));
  });

  return router;
}
