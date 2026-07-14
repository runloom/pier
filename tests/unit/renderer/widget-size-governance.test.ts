import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/**
 * 物料尺寸适配治理检查点。
 *
 * 红线第 8 条：size prop 做结构决策，container query 做布局密度，
 * 禁止用 display:none 静默删除有意义内容。
 */
function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** 在 widget 源码中查找用 container query + hidden/none 隐藏内容的模式。
 *  命中 `@[NNrem]:...hidden`、`hidden...@[NNrem]:...inline`（默认 hidden 再用 CQ 恢复）
 *  均视为 finding——尺寸适配应走 size prop 条件渲染，不是 CQ display:none。
 */
const CONTAINER_QUERY_HIDDEN_PATTERN =
  /@\[\d+rem\]:[^\s"]*hidden|hidden[^\s"]*@\[\d+rem\]/;

const WIDGET_SOURCES = [
  "packages/plugin-codex/src/renderer/accounts-widget.tsx",
  "packages/plugin-codex/src/renderer/usage-meter.tsx",
] as const;

describe("widget size adaptation governance", () => {
  it("documents the size adaptation policy in project agent context", () => {
    const context = source("AGENTS.md");

    expect(context).toContain("尺寸适配");
    expect(context).toContain("size` prop 做结构决策");
    expect(context).toContain("container query 做布局密度");
    expect(context).toContain(
      "禁止用 container query `display: none` 静默删除有意义内容"
    );
    expect(context).toContain("`minSize` 必须能容纳物料核心信息");
  });

  it("clarifies the size/container-query division of labor in the notes", () => {
    const context = source("AGENTS.md");

    expect(context).toContain("size` prop 决定渲染哪些区块（结构决策）");
    expect(context).toContain("决定已渲染区块的排列密度（布局决策）");
  });

  it("documents the repeated-metric intrinsic layout contract", () => {
    const context = source("AGENTS.md");

    expect(context).toContain("重复指标");
    expect(context).toContain("单项时占满整行");
    expect(context).toContain("auto-fit");
    expect(context).toContain("minmax");
    expect(context).toContain("留白优先于分割线");
    expect(context).toContain("不得按尺寸丢弃");
  });

  it("keeps the Codex quota collection intrinsic and complete", () => {
    const contents = source(WIDGET_SOURCES[1]);

    expect(contents).toContain("data-limit-id");
    expect(contents).toContain("auto-fit");
    expect(contents).toContain("minmax(min(100%,");
    expect(contents).toContain("18rem");
    expect(contents).toContain("var(--codex-quota-item-min-width)");
    expect(contents).toContain("content-start");
    expect(contents).not.toContain("@pier/ui/separator");
    expect(contents).not.toContain("justify-between gap-1.5");
    expect(contents).not.toMatch(/\bsize(?:\?|\.)?\.w\b/);
  });

  it("does not use container query display:none to hide content in codex widgets", () => {
    for (const path of WIDGET_SOURCES) {
      const contents = source(path);
      expect(
        contents,
        `${path} should not hide content with container query display:none — use size prop for structural decisions`
      ).not.toMatch(CONTAINER_QUERY_HIDDEN_PATTERN);
    }
  });

  it("uses size prop for structural decisions in accounts widget", () => {
    const accounts = source(WIDGET_SOURCES[0]);
    expect(accounts, "AccountsWidget should use size prop").toMatch(/\bsize\b/);
  });
});
