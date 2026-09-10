// Load the repo-root .env into process.env (existing variables win). Bun only
// auto-loads a .env from the current working directory, and the workspace
// scripts run from packages/server, so the root file is read explicitly.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT_ENV_FILE = resolve(import.meta.dir, "../../../.env");

export const loadDotEnv = (file = ROOT_ENV_FILE): string[] => {
  if (!existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
};
