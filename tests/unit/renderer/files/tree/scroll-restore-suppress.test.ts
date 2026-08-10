import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const uiFile = (relative: string) =>
  readFileSync(join(process.cwd(), "packages/ui/src/file", relative), "utf8");

/**
 * Contract: path-sync must not fight reveal. Scroll writes go through the
 * owner (`withProgrammaticScroll` / `requestLayoutCompensate`); user wheel
 * claims via `claimUserScroll` when the event is not programmatic.
 * Multi-frame lock restore is banned (see file-tree-scroll-ownership governance).
 */
describe("file tree scroll restore suppress contract", () => {
  it("scroll controller restores only via programmatic owner writes", () => {
    const source = uiFile("tree-scroll-controller.ts");
    expect(source).toContain("beginProgrammaticScroll");
    expect(source).toContain("endProgrammaticScroll");
    expect(source).toContain("withProgrammaticScroll");
    expect(source).toContain("requestLayoutCompensate");
    expect(source).toContain("isProgrammaticScrollEvent");
    expect(source).toContain("claimUserScroll");
    // Legacy depth-ref suppress path is retired in favor of scroll owner.
    expect(source).not.toContain("suppressRestoreDepthRef");
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
