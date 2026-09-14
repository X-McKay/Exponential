// Production bundle: Bun's bundler, HTML entry point, hashed assets in dist/.
import { copyFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const outdir = join(import.meta.dir, "dist");
rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/index.html")],
  outdir,
  minify: true,
  sourcemap: process.env.BUILD_SOURCEMAPS === "off" ? "none" : "linked",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const license = join(outdir, "LICENSE-Google-Sans-Flex.txt");
copyFileSync(join(import.meta.dir, "src/fonts/LICENSE-Google-Sans-Flex.txt"), license);
const total = result.outputs.reduce((a, o) => a + o.size, statSync(license).size);
console.log(`built ${result.outputs.length + 1} files (${(total / 1024).toFixed(1)} kB) → ${outdir}`);
