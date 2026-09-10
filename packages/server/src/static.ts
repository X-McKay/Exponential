import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

/** Serve a built SPA from a directory, falling back to index.html. */
export const staticHandler = (dir: string): ((req: Request) => Promise<Response>) => {
  const root = resolve(dir);
  const index = join(root, "index.html");
  return async (req) => {
    const pathname = decodeURIComponent(new URL(req.url).pathname);
    const candidate = normalize(join(root, pathname));
    if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) {
      const immutable = !(pathname === "/" || pathname.endsWith(".html"));
      return new Response(Bun.file(candidate), {
        headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
    if (!existsSync(index)) return new Response("web bundle not built: run `bun run build`", { status: 503 });
    return new Response(Bun.file(index), { headers: { "cache-control": "no-cache" } });
  };
};
