import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { STATE_FILE, readHarness } from "./harness.ts";

const stop = (pid: number | undefined): void => {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;
  const h = readHarness();
  if (h.pids.container) spawnSync(process.env.CONTAINER_ENGINE ?? "docker", ["stop", "--time", "20", h.pids.container], { stdio: "inherit" });
  stop(h.pids.server);
  stop(h.pids.provider);
  await new Promise((r) => setTimeout(r, 300));
  rmSync(h.tmpDir, { recursive: true, force: true });
}
