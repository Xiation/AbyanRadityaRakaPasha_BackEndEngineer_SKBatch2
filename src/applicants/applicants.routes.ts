import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createApplicant, updateStage, getApplicant, listApplicants } from "./applicants.service.ts";
import { parseOrThrow } from "../helper/validate.ts";
import { methodNotAllowed } from "../middleware/httpGuards.ts";
import { createApplicantSchema, idParamSchema, updateStageSchema, listQuerySchema } from "./applicants.schemas.ts";
import type { Role } from "./stages.ts";

// HTTP only: parse + validate input, call the service, send the response.
// Mounted at /v1/applicants. Routes (contract: docs/openapi.yaml):
//   POST  /           create
//   GET   /           list       (recruiter only)
//   GET   /:id        detail
//   PATCH /:id/stage  update stage
// Each path ends with .all(methodNotAllowed(...)) so other methods get 405 + Allow instead of 404.
export function applicantsRouter(db: DatabaseSync): Router {
  const router = Router();

  router
    .route("/")
    .get((req, res) => {
      const query = parseOrThrow(listQuerySchema, req.query);
      res.json(listApplicants(db, query, res.locals.role as Role));
    })
    .post((req, res) => {
      const input = parseOrThrow(createApplicantSchema, req.body);
      const role = res.locals.role as Role;
      const id = createApplicant(db, input, role);
      res.status(201).location(`/v1/applicants/${id}`).json(getApplicant(db, id, role));
    })
    .all(methodNotAllowed(["GET", "POST"]));

  router
    .route("/:id/stage")
    .patch((req, res) => {
      const { id } = parseOrThrow(idParamSchema, req.params);
      const body = parseOrThrow(updateStageSchema, req.body);
      const role = res.locals.role as Role;
      updateStage(db, id, body.to_stage, body.reason ?? null, body.notes ?? null, role);
      res.status(200).json(getApplicant(db, id, role));
    })
    .all(methodNotAllowed(["PATCH"]));

  router
    .route("/:id")
    .get((req, res) => {
      const { id } = parseOrThrow(idParamSchema, req.params);
      res.json(getApplicant(db, id, res.locals.role as Role));
    })
    .all(methodNotAllowed(["GET"]));

  return router;
}
