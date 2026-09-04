import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-04-window-os-title-gold-standard.md";
const ALGORITHM = "src/shared/window-display/index.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walkTs(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "out") {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkTs(full, files);
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("window display gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### 窗口系统标题与多窗显示名");
    expect(agents).toContain("src/shared/window-display");
    expect(agents).toContain(
      "tests/unit/renderer/window-display-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("稳定 tab 名（白名单）");
    expect(spec).toContain("display.terminalTitle");
    expect(spec).toContain("source=user");
  });

  it("keeps the naming algorithm in src/shared/window-display", () => {
    expect(read(ALGORITHM)).toContain("export function buildWindowDisplays");
    const sources = walkTs(join(ROOT, "src")).map((file) =>
      file.slice(ROOT.length + 1)
    );
    const definitions = sources.filter((file) => {
      if (file.startsWith("src/shared/window-display/")) {
        return false;
      }
      const text = read(file);
      return /export function buildWindowDisplays\b/.test(text);
    });
    expect(definitions).toEqual([]);
  });

  it("does not let relocate or Index recompute names", () => {
    const pickWindow = read(
      "src/renderer/components/workspace/transfer/pick-window.ts"
    );
    expect(pickWindow).not.toContain("buildWindowDisplays");
    expect(pickWindow).not.toContain("?? candidate.recordId");
    expect(
      read("src/renderer/lib/agent-runtime/index-quickpick.ts")
    ).not.toContain("buildWindowDisplays");
    expect(
      read("src/renderer/lib/context-menu/expand-window-relocate.ts")
    ).not.toContain("buildWindowDisplays");
    expect(
      read("src/renderer/lib/agent-runtime/collab-view-model.ts")
    ).not.toContain("locationParams: { id:");
  });

  it("does not reference agents.quickPick.windowLabel in product code", () => {
    const sources = walkTs(join(ROOT, "src")).map((file) =>
      file.slice(ROOT.length + 1)
    );
    const hits = sources.filter((file) =>
      read(file).includes("agents.quickPick.windowLabel")
    );
    expect(hits).toEqual([]);
  });
});
