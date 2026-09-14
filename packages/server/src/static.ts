import { realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const within = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** Return a regular file only when both its lexical and real paths stay under root. */
const containedFile = (lexicalRoot: string, physicalRoot: string, candidate: string): string | null => {
  if (!within(lexicalRoot, candidate)) return null;
  try {
    const actual = realpathSync(candidate);
    if (!within(physicalRoot, actual) || !statSync(actual).isFile()) return null;
    return actual;
  } catch {
    return null;
  }
};

/** Serve a built SPA from a directory, falling back to index.html. */
export const staticHandler = (dir: string): ((req: Request) => Promise<Response>) => {
  const root = resolve(dir);
  // Keep the lexical path for missing bundles, but resolve an existing root so
  // a symlinked build directory cannot make containment checks meaningless.
  let realRoot: string | null = null;
  try {
    realRoot = realpathSync(root);
  } catch {
    // The normal development state has no production bundle yet.
  }
  const physicalRoot = realRoot ?? root;
  const index = join(root, "index.html");
  return async (req) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname);
      // NULs and backslashes are not valid asset paths. Rejecting backslashes
      // also keeps the check portable to Windows path semantics.
      if (pathname.includes("\0") || pathname.includes("\\")) throw new URIError("invalid path");
    } catch {
      return new Response("malformed path", { status: 400 });
    }
    const candidate = resolve(root, `.${pathname}`);
    if (!within(root, candidate)) return new Response("forbidden path", { status: 403 });
    try {
      const actual = realpathSync(candidate);
      if (!within(physicalRoot, actual)) return new Response("forbidden path", { status: 403 });
    } catch {
      // Missing assets are handled below; extensionless paths may still be SPA routes.
    }
    const file = containedFile(root, physicalRoot, candidate);
    if (file) {
      const immutable = !(pathname === "/" || pathname.endsWith(".html"));
      return new Response(Bun.file(file), {
        headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
    if (extname(pathname)) return new Response("asset not found", { status: 404 });
    const indexFile = containedFile(root, physicalRoot, index);
    if (!indexFile) return new Response("web bundle not built: run `bun run build`", { status: 503 });
    return new Response(Bun.file(indexFile), { headers: { "cache-control": "no-cache" } });
  };
};
