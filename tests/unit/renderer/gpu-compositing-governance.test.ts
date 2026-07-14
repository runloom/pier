import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src/renderer");
const SOURCE_FILE_EXTENSION = /\.(css|tsx?|jsx?)$/;
const FORCED_COMPOSITING_MARKERS = [
  ["backface-visibility", /\bbackface-visibility\s*:/],
  ["perspective", /\bperspective\s*\(/],
  ["transform-gpu", /\btransform-gpu\b/],
  ["translate-z", /\btranslate-z-/],
  ["translate3d", /\btranslate3d\s*\(/],
  ["translateZ", /\btranslateZ\s*\(/],
  [
    "will-change-transform",
    /\bwill-change\s*:\s*transform\b|\bwill-change-\[?transform\]?\b/,
  ],
] as const;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (SOURCE_FILE_EXTENSION.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("renderer GPU 合成层治理", () => {
  it("只允许不透明工作台在拖拽预览期间使用三维位移", () => {
    const matches = sourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return FORCED_COMPOSITING_MARKERS.flatMap(([marker, pattern]) =>
        pattern.test(source)
          ? [{ file: relative(SOURCE_ROOT, file), marker }]
          : []
      );
    });

    // 唯一例外：工作台根节点由不透明 bg-surface-canvas 覆盖；该位移只在
    // 拖拽预览期间存在，结束后立即清除，避免 left/top 每帧触发布局。
    expect(matches).toEqual([
      {
        file: "panel-kits/workbench/workbench-rgl-adapter.ts",
        marker: "translate3d",
      },
    ]);
  });
});
