import { describe, expect, test } from "bun:test";
import { accessFromEnv, requestAccess } from "../src/access.ts";

describe("instance access", () => {
  const check = requestAccess({ origins: ["http://localhost:3000"] });
  test("permits local clients and rejects hostile Host/origin and cross-site browser requests", () => {
    expect(check(new Request("http://localhost:3000/api/state"))).toBeNull();
    expect(check(new Request("http://rebinding.example:3000/api/state"))?.status).toBe(403);
    expect(check(new Request("http://localhost:3000/api/state", { headers: { origin: "https://evil.example" } }))?.status).toBe(403);
    expect(check(new Request("http://localhost:3000/api/state", { headers: { "sec-fetch-site": "cross-site" } }))?.status).toBe(403);
  });
  test("requires the configured token for reads, writes, and live streams", () => {
    const guarded = requestAccess({ origins: ["https://valueflow.example"], token: "synthetic-fixture" });
    for (const path of ["/", "/api/state", "/api/live", "/api/projects"]) {
      expect(guarded(new Request(`https://valueflow.example${path}`))?.status).toBe(401);
      expect(guarded(new Request(`https://valueflow.example${path}`, { headers: { authorization: "Bearer synthetic-fixture" } }))).toBeNull();
    }
  });
  test("defaults to loopback and fails closed for unauthenticated shared hosting", () => {
    expect(accessFromEnv({}, 3000).hostname).toBe("127.0.0.1");
    expect(() => accessFromEnv({ HOST: "0.0.0.0" }, 3000)).toThrow("requires VALUEFLOW_ACCESS_TOKEN");
    expect(() => accessFromEnv({ VALUEFLOW_ORIGINS: "https://example.com/path" }, 3000)).toThrow("exact HTTP(S) origins");
    expect(accessFromEnv({ HOST: "0.0.0.0", VALUEFLOW_ACCESS_TOKEN: "x".repeat(32), VALUEFLOW_ORIGINS: "https://valueflow.example" }, 3000).hostname).toBe("0.0.0.0");
  });
});
