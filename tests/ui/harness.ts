// Shared between global setup and the specs: where the application is, the
// synthetic workspace it was seeded with, and a small API client with the
// same actor headers the browser sends.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STATE_FILE = join(import.meta.dirname, "results", "harness.json");
export const AS_OF = "2026-09-10T09:00:00.000Z";

export interface HarnessState {
  baseUrl: string;
  provider: { baseUrl: string; token: string };
  /** The synthetic workspace as seeded (ids, names, counts), plus a charter per project. */
  seed: { state: SyntheticSummary; charters: Record<string, string> };
  pids: { server?: number; provider?: number; container?: string };
  tmpDir: string;
}

/** The parts of a synthetic AppState the specs look at; typed loosely so the suite does not import the domain package. */
export interface SyntheticSummary {
  asOf: string;
  projects: { id: string; key: string; name: string; stage: string; tier: number | null; description: string; committee: { date: string; ref: string } | null; repos: { name: string; url: string }[]; team: { ini: string; name: string; role: string }[]; targets: { fte: number; time: number }; milestones: { id: string; name: string; status: string; month: string; impact: unknown; metrics: { id: string; label: string; base: number; stretch: number; current: number }[] }[]; governance: { id: string; cat: string; name: string; status: string; owner: string; date: string | null; detail: string }[] }[];
  releases: Record<string, { id: string; name: string; month: string; milestoneIds: string[]; criteria: unknown[] }[]>;
  calendar: { id: string; date: string; proj: string; tab: string; text: string; sub: string | null }[];
  templates: { id: string; name: string }[];
}

export const readHarness = (): HarnessState => JSON.parse(readFileSync(STATE_FILE, "utf8")) as HarnessState;

export const api = (baseUrl: string, actor: { user?: string; role?: string } = {}) => {
  const headers = (body?: unknown): Record<string, string> => ({
    ...(actor.user ? { "x-valueflow-user": actor.user } : {}),
    ...(actor.role ? { "x-valueflow-role": actor.role } : {}),
    ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }),
  });
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(baseUrl + path, { method, headers: headers(body), body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  };
  return { call };
};
