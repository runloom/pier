import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MODULE_DIR = join(ROOT, "src", "main", "services", "notification-center");

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(filePath));
      continue;
    }
    if (/\.ts$/.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

describe("notification-center main module boundary", () => {
  it("does not import services/agents (对齐 foreground-activity 单向边界)", () => {
    const offenders: string[] = [];
    for (const filePath of sourceFiles(MODULE_DIR)) {
      const content = readFileSync(filePath, "utf8");
      if (/from\s+["'][^"']*services\/agents\//.test(content)) {
        offenders.push(relative(ROOT, filePath));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("history persistence stays inside store.ts", () => {
    for (const filePath of sourceFiles(MODULE_DIR)) {
      const rel = relative(ROOT, filePath);
      const content = readFileSync(filePath, "utf8");
      if (rel.endsWith("store.ts")) {
        continue;
      }
      expect(
        /debouncedJsonStore|writeFileAtomic|notifications\.json/.test(content),
        `${rel} 不应直接触碰历史持久化`
      ).toBe(false);
    }
  });
});
