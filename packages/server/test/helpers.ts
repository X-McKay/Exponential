import { createApp } from "../src/app.ts";
import { sampleSource } from "../src/connectors/index.ts";
import type { App } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { SEED_NOW, seed } from "../src/seed.ts";

export const BASE = "http://valueflow.test";

export interface TestApp extends App {
  get: <T = unknown>(path: string) => Promise<{ status: number; body: T }>;
  send: <T = unknown>(method: "PUT" | "POST" | "DELETE", path: string, body?: unknown) => Promise<{ status: number; body: T }>;
}

/** A fresh in-memory, seeded app with typed request helpers. */
export const testApp = (): TestApp => {
  const db = openDb(":memory:");
  seed(db);
  const app = createApp(db, { now: () => SEED_NOW, source: sampleSource() });
  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await app.handleApi(
      new Request(BASE + path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    if (!res) throw new Error(`not an API route: ${path}`);
    return { status: res.status, body: (await res.json()) as T };
  };
  return {
    ...app,
    get: (path) => call("GET", path),
    send: (method, path, body) => call(method, path, body),
  };
};
