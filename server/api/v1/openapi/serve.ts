import type { Router } from "express";
import { apiReference } from "@scalar/express-api-reference";
import { getOpenAPISpec } from "./spec";

export function serveApiDocs(router: Router): void {
  // Raw OpenAPI spec
  router.get("/openapi.json", (_req, res) => {
    res.json(getOpenAPISpec());
  });

  // Interactive Scalar docs UI
  router.use(
    "/docs",
    apiReference({
      content: getOpenAPISpec() as any,
      theme: "default",
    }),
  );
}
