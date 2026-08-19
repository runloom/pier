import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHEBANG = "#!/usr/bin/env node\n";

export function defaultTmuxSourcePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "tmux.js");
}

export function installShim(options: {
  sourcePath?: string;
  workDir: string;
}): string {
  const sourcePath = options.sourcePath ?? defaultTmuxSourcePath();
  let source = readFileSync(sourcePath, "utf8");
  if (!source.startsWith("#!")) {
    source = `${SHEBANG}${source}`;
  } else if (!source.startsWith(SHEBANG.trim())) {
    source = source.replace(/^#![^\n]*\n?/u, SHEBANG);
  }
  const binDir = join(options.workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const dest = join(binDir, "tmux");
  writeFileSync(dest, source, { encoding: "utf8", mode: 0o755 });
  chmodSync(dest, 0o755);
  return dest;
}
