import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HealthCheckResponse } from "@workspace/api-zod";

describe("GET /api/healthz", () => {
  it("API 契約どおりの ok ステータスを返す", async () => {
    const res = await SELF.fetch("http://example.com/api/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(HealthCheckResponse.parse(body)).toEqual({ status: "ok" });
  });
});
