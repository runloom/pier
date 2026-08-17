import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_VIEW_CUSTOM_CSS,
  PIER_DIFF_LIGHT_DOM_CSS,
} from "@pier/ui/diff-view/appearance.ts";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CARD = "packages/ui/src/diff-view/review/inline-thread-card.tsx";
const EDITOR = "packages/ui/src/diff-view/review/inline-comment-editor.tsx";
const COMPOSER = "packages/ui/src/comments/composer.tsx";
/** 任何会在卡片上铺出一层可见 surface 的 class。 */
const FILL_CLASS_RE =
  /\bbg-(?:muted|card|popover|input|background|accent|secondary|surface|\[)/;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/** 只看可执行代码：文档注释里会引用这些 class 名解释为什么不能用。 */
function readCode(relativePath: string): string {
  return read(relativePath)
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*/g, "");
}

/**
 * 行内评论卡与批注行底色分工。
 *
 * 批注行本身由 pierre 画底；曾把行刷成上下文灰，所以 CODE_VIEW_CUSTOM_CSS
 * 仍把 `--diffs-annotation-bg` 压回普通行底。评论卡是叠在这行上的产品卡片
 *（`bg-background` + 阴影），输入壳聚焦时走 `focus-within:ring-*`。
 * 禁止再从 `--diffs-*` 派生一张自定义 surface。
 */
describe("inline comment card fill", () => {
  it("paints the display card as a shadowed product surface", () => {
    const source = readCode(CARD);
    expect(source).toContain("bg-background");
    expect(source).toContain("shadow-sm");
    expect(source).not.toMatch(
      /\bbg-(?:muted|card|popover|input|accent|secondary|surface|\[)/
    );
  });

  it("keeps the git editor adapter on the plain surface", () => {
    expect(readCode(EDITOR)).toContain('surface="plain"');
    expect(readCode(EDITOR)).not.toMatch(FILL_CLASS_RE);
  });

  it("gives the composer a focus ring on both surfaces", () => {
    const source = readCode(COMPOSER);
    expect(source).toContain("focus-within:ring-3");
    expect(source).toContain("focus-within:ring-ring/30");
    expect(source).toContain("bg-background");
  });

  it("does not reintroduce a diff-derived surface token", () => {
    // 曾试过从 --diffs-bg-context 派生 --surface-inline-comment：仍盖掉选中行底色。
    expect(PIER_DIFF_LIGHT_DOM_CSS).not.toContain("--surface-inline-comment");
    expect(read("src/renderer/app/globals.css")).not.toContain(
      "--surface-inline-comment"
    );
  });

  /**
   * 灰块的真正来源是 pierre 的 shadow CSS，不是卡片。它把批注行当上下文块：
   * `[data-line-annotation] { --diffs-annotation-bg: var(--diffs-bg-context) }`，
   * 且 `[data-gutter-buffer="annotation"]` 另取 `--diffs-bg-context-gutter`，
   * 于是渲染成「两侧接近正常 + 中间一块灰」。行与 gutter 都必须压回 `--diffs-bg`。
   */
  it("flattens the annotation row back to the plain line background", () => {
    const rule = CODE_VIEW_CUSTOM_CSS.match(
      /:host\(\[data-pier-file-host]\) \[data-line-annotation],\s*:host\(\[data-pier-file-host]\) \[data-gutter-buffer='annotation'] \{([^}]*)\}/
    );
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain("--diffs-annotation-bg: var(--diffs-bg);");
  });

  it("overrides only the upstream annotation variable", () => {
    // pierre 由 --diffs-annotation-bg 派生 selected-line-bg；直接写死
    // --diffs-line-bg 会让选中行不再变蓝。
    expect(CODE_VIEW_CUSTOM_CSS).not.toContain("--diffs-line-bg:");
  });
});
