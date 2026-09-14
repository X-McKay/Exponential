import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { staticHandler } from "../src/static.ts";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("static file serving", () => {
  test("keeps sibling prefixes and encoded traversal outside the bundle", async () => {
    const parent = mkdtempSync(join(tmpdir(), "valueflow-static-"));
    tempRoots.push(parent);
    const root = join(parent, "dist");
    const sibling = join(parent, "dist-private");
    mkdirSync(root);
    mkdirSync(sibling);
    writeFileSync(join(root, "index.html"), "index");
    writeFileSync(join(sibling, "secret.txt"), "secret");
    const serve = staticHandler(root);

    const escaped = await serve(new Request("http://example.test/%2e%2e%2fdist-private%2fsecret.txt"));
    expect(escaped.status).toBe(403);
  });

  test("does not serve a symlink that resolves outside the bundle", async () => {
    const parent = mkdtempSync(join(tmpdir(), "valueflow-static-"));
    tempRoots.push(parent);
    const root = join(parent, "dist");
    const outside = join(parent, "outside.txt");
    mkdirSync(root);
    writeFileSync(join(root, "index.html"), "index");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(root, "link.txt"));
    const res = await staticHandler(root)(new Request("http://example.test/link.txt"));
    expect(res.status).toBe(403);
  });

  test("rejects malformed encodings and falls back for missing assets", async () => {
    const root = mkdtempSync(join(tmpdir(), "valueflow-static-"));
    tempRoots.push(root);
    writeFileSync(join(root, "index.html"), "index");
    const serve = staticHandler(root);
    expect((await serve(new Request("http://example.test/%E0%A4%A"))).status).toBe(400);
    const missing = await serve(new Request("http://example.test/missing.js"));
    expect(missing.status).toBe(404);
  });
});
