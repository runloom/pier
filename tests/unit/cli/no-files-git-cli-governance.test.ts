/**
 * W4-S1 治理：产品 CLI 不新增 files/git 命令组；
 * 文件/Git 内容由调用方本地工具读取，Pier 只返回 WorktreeRef 定位。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLI_USER_MANUAL_DATA_PATH,
  REQUIRED_SHIPPED_COMMAND_NAMES,
} from "./cli-docs-surface.ts";

const ROOT = process.cwd();
const BIN_DIR = join(ROOT, "bin");

function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listJsFiles(full));
      continue;
    }
    if (name.endsWith(".js") || name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

describe("no files/git product CLI group (W4-S1)", () => {
  it("bin/pier parsers do not register pier files / pier git domains", () => {
    const files = listJsFiles(BIN_DIR);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/\bdomain\s*===\s*["']files["']/u.test(text)) {
        hits.push(`${file}: domain files`);
      }
      if (/\bdomain\s*===\s*["']git["']/u.test(text)) {
        hits.push(`${file}: domain git`);
      }
      if (/^export\s+function\s+parseFiles\b/mu.test(text)) {
        hits.push(`${file}: parseFiles`);
      }
      if (/^export\s+function\s+parseGit\b/mu.test(text)) {
        hits.push(`${file}: parseGit`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("user-manual shipped surface has no files/git command names", () => {
    const raw = JSON.parse(readFileSync(CLI_USER_MANUAL_DATA_PATH, "utf8")) as {
      data: {
        commandGroups?: Array<{
          shipped?: Array<{ name: string }>;
          planned?: Array<{ name: string }>;
        }>;
        agents?: {
          shipped?: Array<{ name: string }>;
        };
        core?: {
          shipped?: Array<{ name: string }>;
        };
      };
    };
    const names = new Set<string>(REQUIRED_SHIPPED_COMMAND_NAMES);
    const walk = (cmds?: Array<{ name: string }>) => {
      for (const c of cmds ?? []) {
        names.add(c.name);
      }
    };
    walk(raw.data.core?.shipped);
    walk(raw.data.agents?.shipped);
    for (const g of raw.data.commandGroups ?? []) {
      walk(g.shipped);
    }
    for (const name of names) {
      expect(name).not.toMatch(/^\s*files\b/u);
      expect(name).not.toMatch(/^\s*git\b/u);
    }
  });
});
