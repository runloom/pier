import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const OVERLAY = join(
  process.cwd(),
  "src/plugins/builtin/files/renderer/preview/canvas-comment-overlay.tsx"
);

describe("canvas comment overlay height", () => {
  it("covers the shell with inset-0 instead of a sticky inline minHeight", () => {
    const source = readFileSync(OVERLAY, "utf8");
    expect(source).toContain("absolute inset-0");
    expect(source).not.toMatch(/style\.minHeight/);
    expect(source).not.toMatch(/shell\.scrollHeight/);
  });
});
