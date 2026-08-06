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
 * 行内评论卡「无填充」契约。
 *
 * 批注行底色由 diff 引擎画（pierre 把 `--diffs-annotation-bg` 设为
 * `--diffs-bg-context`，选中行还会再叠一层选中色），且卡片是
 * `<diffs-container>` 的 light DOM slot 子节点，拿不到 shadow 内的批注变量。
 * 卡片自带任何 surface（产品 `bg-muted/xx`、`InputGroup` 默认 `bg-input/50`、
 * 或从 diff 令牌派生的自定义 surface）都会盖掉行底色、与周围割裂。
 *
 * 结论：展示态与编辑态一律 `bg-transparent`，只靠 1px 边框划边界。这条既不会
 * 被类型也不会被 lint 拦住，故在此锁定。
 */
describe("inline comment card fill", () => {
  it("keeps display and edit states unfilled", () => {
    for (const path of [CARD, EDITOR]) {
      const source = readCode(path);
      expect(source).toContain("bg-transparent");
      expect(source).not.toMatch(FILL_CLASS_RE);
    }
  });

  it("neutralizes the InputGroup default surface", () => {
    // InputGroup 根壳自带 bg-input/50，不显式覆写就会漏出来。
    expect(readCode(EDITOR)).toMatch(
      /<InputGroup className="[^"]*\bbg-transparent\b/
    );
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
