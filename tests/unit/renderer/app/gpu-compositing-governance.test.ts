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
  it("禁止产品表面为合成层强制三维位移", () => {
    const matches = sourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return FORCED_COMPOSITING_MARKERS.flatMap(([marker, pattern]) =>
        pattern.test(source)
          ? [{ file: relative(SOURCE_ROOT, file), marker }]
          : []
      );
    });

    expect(matches).toEqual([]);
  });
});
