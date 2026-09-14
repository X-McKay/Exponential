import { existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const markdown = ["README.md"];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".md")) markdown.push(path);
  }
};
walk("docs");

const broken: string[] = [];
for (const file of markdown) {
  const body = await Bun.file(file).text();
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1]!.replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#", 1)[0]!);
    if (target && !existsSync(normalize(join(dirname(file), target)))) broken.push(`${file}: ${raw}`);
  }
}

if (broken.length) throw new Error(`Broken local documentation links:\n${broken.join("\n")}`);
console.log(`Documentation links valid across ${markdown.length} Markdown files.`);
