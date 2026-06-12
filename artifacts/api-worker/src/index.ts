import { Hono } from "hono";
import { healthRoutes } from "./routes/health.js";

const app = new Hono().basePath("/api");

app.route("/", healthRoutes);

export default app;
