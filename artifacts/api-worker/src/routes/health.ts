import { Hono } from "hono";
import { HealthCheckResponse } from "@workspace/api-zod";

export const healthRoutes = new Hono().get("/healthz", (c) =>
  c.json(HealthCheckResponse.parse({ status: "ok" })),
);
