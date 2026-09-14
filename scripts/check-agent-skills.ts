import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const roots = [".agents/skills", ".claude/skills"] as const;
const files = (root: string): string[] => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(root, path)];
  });
  return walk(root).sort();
};

const [codexFiles, claudeFiles] = roots.map(files);
if (JSON.stringify(codexFiles) !== JSON.stringify(claudeFiles)) {
  throw new Error(`Codex and Claude skill file lists differ:\nCodex: ${codexFiles.join(", ")}\nClaude: ${claudeFiles.join(", ")}`);
}

for (const file of codexFiles) {
  const [codex, claude] = await Promise.all(roots.map((root) => Bun.file(join(root, file)).text()));
  if (codex !== claude) throw new Error(`Codex and Claude skill content differs: ${file}`);
}

console.log(`Claude and Codex skills match: ${codexFiles.length} files across ${new Set(codexFiles.map((file) => file.split("/")[0])).size} skills.`);
