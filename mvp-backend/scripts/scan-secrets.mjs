import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ignoredDirectories = new Set(["node_modules", "dist", ".git", "coverage"]);
const allowedExtensions = new Set([".ts", ".js", ".mjs", ".json", ".yaml", ".yml", ".md", ".example"]);
const secretPatterns = [
  { name: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

const findings = [];
for (const file of await walk(root)) {
  const extension = file.endsWith(".env.example") ? ".example" : extname(file);
  if (!allowedExtensions.has(extension)) continue;
  const content = await readFile(file, "utf8");
  for (const candidate of secretPatterns) {
    for (const match of content.matchAll(candidate.pattern)) {
      findings.push(`${relative(root, file)}:${lineNumber(content, match.index ?? 0)} ${candidate.name}`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`Potential secrets found:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("No credential-shaped secrets found in source files.\n");
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}
