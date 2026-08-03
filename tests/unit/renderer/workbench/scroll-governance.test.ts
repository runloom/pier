import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ACCOUNT_WIDGET_SOURCES = [
  "packages/plugin-codex/src/renderer/accounts-widget.tsx",
  "packages/plugin-claude/src/renderer/accounts-widget.tsx",
  "packages/plugin-grok/src/renderer/accounts-widget.tsx",
] as const;
const DESIGN_PATH =
  "docs/superpowers/specs/2026-07-29-workbench-scroll-viewport-design.md";

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("workbench scroll viewport governance", () => {
  it("documents single-owner scrolling and viewport-only fades", () => {
    const context = source("AGENTS.md");

    expect(context).toContain("#### 工作台滚动区域");
    expect(context).toContain("contentMode");
    expect(context).toContain("viewportFade");
    expect(context).toContain("单一滚动所有者");
    expect(context).toContain("禁止使用负边距");
  });

  it("keeps account widgets on the shared frame without native nested scrolling", () => {
    for (const path of ACCOUNT_WIDGET_SOURCES) {
      const contents = source(path);
      expect(contents).toContain("AccountWidgetFrame");
      expect(contents).not.toContain("overflow-y-auto");
      expect(contents).not.toContain("widgetShellClassName");
    }
  });

  it("records the closed-out global scrollbar and viewport-fade strategy", () => {
    const design = source(DESIGN_PATH);

    expect(design).toContain("## 滚动条策略（已收口）");
    expect(design).toContain("light DOM");
    expect(design).toContain("Shadow");
    expect(design).toContain("Radix `ScrollArea`");
    expect(design).toContain("installDocumentAutoHideScrollbars");
    expect(design).toContain('data-scrollbar="none"');
  });
});
