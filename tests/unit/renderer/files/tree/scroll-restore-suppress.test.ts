import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const uiFile = (relative: string) =>
  readFileSync(join(process.cwd(), "packages/ui/src/file", relative), "utf8");

/**
 * Contract: while reveal holds programmatic scroll, path-sync must not pin
 * scrollTop back to the pre-mutation (root) snapshot — first-open deep paths
 * load ancestors then reveal; restore-with-lock was overwriting scrollToPath.
 */
describe("file tree scroll restore suppress contract", () => {
  it("scroll controller skips restore while suppress depth > 0", () => {
    const source = uiFile("tree-scroll-controller.ts");
    expect(source).toContain("beginProgrammaticScroll");
    expect(source).toContain("endProgrammaticScroll");
    expect(source).toContain("suppressRestoreDepthRef");
    expect(source).toMatch(
      /if\s*\(\s*suppressRestoreDepthRef\.current\s*>\s*0\s*\)/
    );
  });

  it("reveal controller holds programmatic scroll for scrolled reveals", () => {
    const source = uiFile("use-tree-reveal-controller.ts");
    expect(source).toContain("holdProgrammaticScroll");
    expect(source).toContain("releaseProgrammaticScroll");
    expect(source).toContain("beginProgrammaticScroll");
    expect(source).toContain("scheduleReleaseAfterIdle");
    expect(source).toContain("explicitSuppressPathRef");
    // Skip path must not clear foreign explicit pending.
    expect(source).toContain('pending.options.intent === "active-file"');
  });
});
