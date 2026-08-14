import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");

describe("active-file reveal re-settle contract (P3)", () => {
  const revealController = readFileSync(
    join(REPO_ROOT, "packages/ui/src/file/use-tree-reveal-controller.ts"),
    "utf8"
  );
  const activeFileReveal = readFileSync(
    join(REPO_ROOT, "packages/ui/src/file/use-tree-active-file-reveal.ts"),
    "utf8"
  );

  it("tracks settled active-file paths so temporary gaps do not re-nearest", () => {
    expect(revealController).toContain("settledActiveFilePathRef");
    expect(activeFileReveal).toContain("Temporary gap after settle");
    expect(activeFileReveal).toMatch(
      /if \(item\) \{\s*return;\s*\}[\s\S]*Temporary gap after settle/
    );
    expect(activeFileReveal).not.toMatch(
      /if \(!item\) \{\s*requestReveal\(revealPath/
    );
  });

  it("suppresses scroll when the user claim window is active", () => {
    expect(revealController).toContain("isUserScrolling");
    expect(revealController).toContain('scroll: "none"');
    expect(revealController).toContain("scrollSuppressedByUser");
  });

  it("sticks user abort across the claim window via subscribeUserClaim", () => {
    expect(revealController).toContain("userAbortedScrollRef");
    expect(revealController).toContain("subscribeUserClaim");
    expect(revealController).toContain("demotePendingScroll");
  });

  it("lets breadcrumb/explicit reveal of the settled file clear sticky abort", () => {
    expect(revealController).toContain("shouldClearRevealUserAbort");
    expect(revealController).toContain("shouldHonorUserScrollAbort");
    expect(revealController).not.toMatch(
      /settledActiveFilePathRef\.current !== path\s*\n\s*\) \{\s*\n\s*userAbortedScrollRef\.current = false/m
    );
  });
});
