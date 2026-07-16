import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Progress 指示器保留进度位移动画，但只过渡 transform，并尊重
 * prefers-reduced-motion。
 */
describe("Progress indicator transition policy", () => {
  it("animates transform only and respects reduced motion", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/ui/src/progress.tsx"),
      "utf8"
    );
    expect(source).toContain("transition-transform");
    expect(source).toContain("motion-reduce:transition-none");
    expect(source).not.toContain("transition-all");
  });
});
