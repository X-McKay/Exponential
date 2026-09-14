import { timingSafeEqual } from "node:crypto";

export interface AccessOptions {
  /** Exact browser origins allowed to reach this instance. */
  origins: string[];
  /** A trusted proxy or integration supplies this bearer token. Never ship it to the browser. */
  token?: string;
}

/** Check every request, including HTML and live streams, before dispatch. */
export const requestAccess = ({ origins, token }: AccessOptions) => {
  const allowed = new Set(origins.map((origin) => new URL(origin).origin));
  return (req: Request): Response | null => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    if (!allowed.has(url.origin) || (origin !== null && !allowed.has(origin)) || req.headers.get("sec-fetch-site") === "cross-site") {
      return Response.json({ error: "request origin is not allowed" }, { status: 403 });
    }
    if (token) {
      const supplied = Buffer.from(req.headers.get("authorization") ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return Response.json({ error: "authentication required" }, { status: 401, headers: { "www-authenticate": "Bearer" } });
      }
    }
    return null;
  };
};

export const accessFromEnv = (env: Record<string, string | undefined>, port: number) => {
  const hostname = env.HOST ?? "127.0.0.1";
  const token = env.VALUEFLOW_ACCESS_TOKEN?.trim();
  const local = ["127.0.0.1", "::1", "localhost"].includes(hostname);
  if (!local && env.VALUEFLOW_TRUSTED_WORKSPACE !== "on" && (!token || token.length < 32)) throw new Error("Non-loopback HOST requires VALUEFLOW_ACCESS_TOKEN with at least 32 characters and a trusted authenticating proxy.");
  if (token && token.length < 32) throw new Error("VALUEFLOW_ACCESS_TOKEN must contain at least 32 characters.");
  const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, ...(env.VALUEFLOW_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  for (const origin of origins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== origin) throw new Error("VALUEFLOW_ORIGINS must contain exact HTTP(S) origins without paths or credentials.");
  }
  return { hostname, check: requestAccess({ origins, ...(token ? { token } : {}) }) };
};
