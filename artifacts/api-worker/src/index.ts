import { Hono } from "hono";

const app = new Hono().basePath("/api");

export default app;
