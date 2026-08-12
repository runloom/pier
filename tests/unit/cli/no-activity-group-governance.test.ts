/**
 * W4-S3：无独立 activity 命令组；事实流归顶层 snapshot/watch。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function listJs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listJs(full));
      continue;
    }
    if (name.endsWith(".js") || name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

describe("no activity CLI group (W4-S3)", () => {
  it("bin does not register pier activity domain", () => {
    const hits: string[] = [];
    for (const file of listJs(join(ROOT, "bin"))) {
      const text = readFileSync(file, "utf8");
      if (/\bdomain\s*===\s*["']activity["']/u.test(text)) {
        hits.push(file);
      }
      if (/parseActivity\b/u.test(text)) {
        hits.push(`${file}:parseActivity`);
      }
    }
    expect(hits).toEqual([]);
  });
});
