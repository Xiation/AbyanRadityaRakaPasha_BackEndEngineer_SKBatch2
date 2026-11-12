// Serves the OpenAPI contract (docs/openapi.yaml) as Swagger UI at /docs, and the raw spec at /openapi.json.
// The YAML file is the single source of truth: the same file is documentation and "try it out" UI.
import { readFileSync } from "node:fs";
import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { parse } from "yaml";

const specUrl = new URL("../docs/openapi.yaml", import.meta.url);

export function mountDocs(app: Express): void {
  const spec = parse(readFileSync(specUrl, "utf8")) as Record<string, unknown>;

  app.get("/openapi.json", (_req, res) => {
    res.json(spec);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "Applicant Records API" }));
}
